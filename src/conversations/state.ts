import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  conversations,
  conversationState,
  messages,
  aiAnalysis,
  conversationEvents,
} from '../db/schema.js';
import type { AIOutput } from '../ai/schemas.js';

export async function applyConversationUpdate(
  conversationId: string,
  analysis: AIOutput,
  triggerMessageId: string,
  inputMessageIds: string[],
  modelName: string
) {
  const now = new Date();

  await db.transaction(async (tx) => {
    // 1. Filter out null state updates
    const updatesToApply: Record<string, any> = {};
    if (analysis.state_updates) {
      if (analysis.state_updates.travel_date != null) updatesToApply.travelDate = analysis.state_updates.travel_date;
      if (analysis.state_updates.guest_count != null) updatesToApply.guestCount = analysis.state_updates.guest_count;
      if (analysis.state_updates.bedrooms_required != null) updatesToApply.bedroomsRequired = analysis.state_updates.bedrooms_required;
      if (analysis.state_updates.boat_type != null) updatesToApply.boatType = analysis.state_updates.boat_type;
      if (analysis.state_updates.budget != null) updatesToApply.budget = analysis.state_updates.budget?.toString();
      if (analysis.state_updates.main_objection != null) updatesToApply.mainObjection = analysis.state_updates.main_objection;
    }

    // Apply state updates if there are any
    if (Object.keys(updatesToApply).length > 0) {
      updatesToApply.updatedAt = now;
      await tx
        .update(conversationState)
        .set(updatesToApply)
        .where(eq(conversationState.conversationId, conversationId));
    }

    // 2. Update conversation summary and lead status
    const convUpdates: Record<string, any> = {
      summary: analysis.summary,
      updatedAt: now,
    };
    if (analysis.lead_status != null) convUpdates.leadStatus = analysis.lead_status;
    if (analysis.lead_stage != null) convUpdates.leadStage = analysis.lead_stage;
    if (analysis.lead_score != null) convUpdates.leadScore = analysis.lead_score;

    await tx
      .update(conversations)
      .set(convUpdates)
      .where(eq(conversations.conversationId, conversationId));

    console.log(`\n🧠 [AI ANALYSIS RECORD] For Conversation: ${conversationId}`);
    console.log(JSON.stringify(analysis, null, 2));

    // 3. Save AI analysis record
    const [savedAnalysis] = await tx
      .insert(aiAnalysis)
      .values({
        conversationId,
        triggerMessageId,
        inputMessageIds: inputMessageIds,
        intent: analysis.intent ?? null,
        leadStatus: (analysis.lead_status ?? null) as any,
        leadStage: (analysis.lead_stage ?? null) as any,
        leadScore: analysis.lead_score ?? null,
        stateUpdates: analysis.state_updates ?? null,
        events: analysis.events ?? null,
        summary: analysis.summary ?? null,
        confidence: analysis.confidence?.toString() ?? null,
        model: modelName,
        createdAt: now,
      })
      .returning({ analysisId: aiAnalysis.analysisId });

    // 4. Create meaningful events (Deduplication Check)
    if (analysis.events && analysis.events.length > 0) {
      for (const event of analysis.events) {
        // Skip malformed/empty events from LLM
        if (!event.type) continue;

        // Simple deduplication check: look for recent events of the same type for this conversation
        // A more robust approach might hash the event data.
        const existingEvents = await tx.query.conversationEvents.findMany({
          where: (fields, { eq, and }) =>
            and(
              eq(fields.conversationId, conversationId),
              eq(fields.eventType, event.type as any)
            ),
          orderBy: (fields, { desc }) => [desc(fields.eventTimestamp)],
          limit: 1,
        });

        // Skip if we already logged this same exact event recently
        const shouldLog = existingEvents.length === 0 || JSON.stringify(existingEvents[0]?.eventData) !== JSON.stringify(event.data);

        if (shouldLog) {
          try {
            await tx.insert(conversationEvents).values({
              conversationId,
              eventType: event.type as any,
              eventData: event.data,
              performedByType: 'system', // AI system generated
              eventTimestamp: now,
              createdAt: now,
            });
          } catch (err) {
            console.warn(`[AI] Could not insert event of type ${event.type}. Check enum in DB.`);
          }
        }
      }
    }

    // 5. Mark messages as AI processed
    if (inputMessageIds.length > 0) {
      await tx
        .update(messages)
        .set({
          aiProcessedAt: now,
          aiAnalysisId: savedAnalysis?.analysisId,
        })
        .where(inArray(messages.messageId, inputMessageIds));
    }
  });
}
