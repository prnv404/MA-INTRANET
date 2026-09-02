import { eq, isNull, desc, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { conversations, conversationState, messages } from '../db/schema.js';

export async function getConversationContext(conversationId: string) {
  // 1. Get conversation summary and current state
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.conversationId, conversationId),
  });

  const state = await db.query.conversationState.findFirst({
    where: eq(conversationState.conversationId, conversationId),
  });

  // 2. Get unprocessed messages (aiProcessedAt IS NULL)
  // We only analyze text messages to save tokens and avoid errors.
  const allUnprocessedMessages = await db.query.messages.findMany({
    where: and(
      eq(messages.conversationId, conversationId),
      isNull(messages.aiProcessedAt),
      eq(messages.messageType, 'text')
    ),
    orderBy: [desc(messages.messageTimestamp)],
  });

  // Since we ordered by desc to get the most recent, let's reverse to chronological order
  const unprocessedMessages = allUnprocessedMessages.reverse();

  // 3. Get recent messages for context (last 5 messages before the unprocessed ones)
  // We find messages where aiProcessedAt is NOT null
  let recentMessages: any[] = [];
  if (unprocessedMessages.length > 0) {
    const lastUnprocessedTimestamp = unprocessedMessages[0]?.messageTimestamp;
    
    // Get the most recent 5 processed text messages before the current batch
    const recentDbMessages = await db.query.messages.findMany({
      where: and(
        eq(messages.conversationId, conversationId),
        eq(messages.messageType, 'text')
      ),
      orderBy: [desc(messages.messageTimestamp)],
      limit: 5,
    });
    
    // Filter down to only those that are not in the unprocessed batch
    const unprocessedIds = new Set(unprocessedMessages.map(m => m.messageId));
    recentMessages = recentDbMessages
      .filter(m => !unprocessedIds.has(m.messageId))
      .reverse();
  }

  // Format messages for the prompt
  const formatMsg = (m: any) => `[${m.messageTimestamp.toISOString()}] ${m.senderType === 'customer' ? 'Customer' : 'Sales'}: "${m.messageText}"`;

  const unprocessedStr = unprocessedMessages.map(formatMsg).join('\n');
  const recentStr = recentMessages.map(formatMsg).join('\n');

  // Build the context string
  const contextParts = [];
  
  contextParts.push(`--- CURRENT STATE ---`);
  contextParts.push(JSON.stringify({
    travel_date: state?.travelDate,
    guest_count: state?.guestCount,
    bedrooms_required: state?.bedroomsRequired,
    boat_type: state?.boatType,
    budget: state?.budget,
    main_objection: state?.mainObjection,
    lead_status: conversation?.leadStatus,
    lead_stage: conversation?.leadStage,
  }, null, 2));
  
  contextParts.push(`\n--- SUMMARY ---`);
  contextParts.push(conversation?.summary || "No summary yet.");
  
  if (recentStr) {
    contextParts.push(`\n--- RECENT CONTEXT MESSAGES ---`);
    contextParts.push(recentStr);
  }
  
  contextParts.push(`\n--- UNPROCESSED MESSAGES ---`);
  contextParts.push(unprocessedStr);

  return {
    contextStr: contextParts.join('\n'),
    unprocessedMessages,
  };
}
