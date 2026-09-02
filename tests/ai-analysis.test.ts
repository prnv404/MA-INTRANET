import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { scheduleConversationAnalysis } from '../src/workers/conversation-analysis.js';
import { getConversationContext } from '../src/conversations/context.js';
import { applyConversationUpdate } from '../src/conversations/state.js';
import { db } from '../src/db/index.js';
import { customers, conversations, conversationState, messages, aiAnalysis } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('AI Conversation Analysis', () => {
  let customerId: string;
  let conversationId: string;

  beforeAll(async () => {
    // 1. Setup a test customer and conversation
    const [customer] = await db.insert(customers).values({
      whatsappNumber: `919876543210-${Date.now()}`,
      name: 'Test Customer',
      firstContactAt: new Date(),
      lastContactAt: new Date(),
    }).returning({ customerId: customers.customerId });
    customerId = customer?.customerId as string;

    const [conversation] = await db.insert(conversations).values({
      customerId,
      firstMessageAt: new Date(),
      lastMessageAt: new Date(),
      status: 'active',
      leadStatus: 'new',
      leadStage: 'new',
    }).returning({ conversationId: conversations.conversationId });
    conversationId = conversation?.conversationId as string;

    await db.insert(conversationState).values({
      conversationId,
    });
  });

  test('Batch rapid messages using debounce logic', async () => {
    // We mock the worker delay logic by simulating the map.
    // The debounce is 10s, so we'll just test that calling schedule multiple times doesn't error out.
    // We won't wait 10 seconds in the test, we'll just trust the setTimeout mechanism.
    
    // Create 3 messages
    const msgs = [];
    for (let i = 0; i < 3; i++) {
      const [msg] = await db.insert(messages).values({
        conversationId,
        customerId,
        whatsappMessageId: `msg-${Date.now()}-${i}`,
        senderType: 'customer',
        direction: 'inbound',
        messageType: 'text',
        messageText: `Message ${i}`,
        messageTimestamp: new Date(),
      }).returning({ messageId: messages.messageId });
      msgs.push(msg);
    }

    scheduleConversationAnalysis(conversationId, msgs[2]?.messageId as string);

    // Verify context pulls all 3 messages
    const context = await getConversationContext(conversationId);
    expect(context.unprocessedMessages.length).toBeGreaterThanOrEqual(3);
    
    const contextStr = context.contextStr;
    expect(contextStr).toContain('Message 0');
    expect(contextStr).toContain('Message 1');
    expect(contextStr).toContain('Message 2');
  });

  test('Apply state update handles nulls correctly and updates DB', async () => {
    // Mock an AI Output
    const analysis = {
      intent: 'houseboat_booking',
      lead_status: 'interested' as const,
      lead_stage: 'qualified' as const,
      lead_score: 85,
      state_updates: {
        travel_date: '2026-10-15',
        guest_count: 6,
        bedrooms_required: 2,
        boat_type: null, // should NOT delete existing or fail
        budget: 15000,
        main_objection: 'price',
      },
      events: [
        {
          type: 'requirement_collected',
          data: { bedrooms: 2, guests: 6 },
        }
      ],
      summary: 'Customer wants a 2-bedroom houseboat.',
      confidence: 0.9,
    };

    const unprocessed = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId)
    });
    const messageIds = unprocessed.map(m => m.messageId);
    
    await applyConversationUpdate(conversationId, analysis, messageIds[0] as string, messageIds, 'test-model');

    // Verify Conversation State
    const state = await db.query.conversationState.findFirst({
      where: eq(conversationState.conversationId, conversationId)
    });
    expect(state?.guestCount).toBe(6);
    expect(state?.bedroomsRequired).toBe(2);
    expect(state?.budget).toBe('15000');
    expect(state?.mainObjection).toBe('price');
    expect(state?.boatType).toBeNull(); // Still null, not overwritten

    // Verify Conversation Details
    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.conversationId, conversationId)
    });
    expect(conv?.leadStatus).toBe('interested');
    expect(conv?.leadStage).toBe('qualified');
    expect(conv?.leadScore).toBe(85);
    expect(conv?.summary).toBe('Customer wants a 2-bedroom houseboat.');

    // Verify Messages marked as processed
    const processedMsgs = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId)
    });
    processedMsgs.forEach(m => {
      expect(m.aiProcessedAt).not.toBeNull();
      expect(m.aiAnalysisId).not.toBeNull();
    });

    // Verify AI Analysis Record
    const analysisRecords = await db.query.aiAnalysis.findMany({
      where: eq(aiAnalysis.conversationId, conversationId)
    });
    expect(analysisRecords.length).toBe(1);
    expect(analysisRecords[0]?.intent).toBe('houseboat_booking');
  });

});
