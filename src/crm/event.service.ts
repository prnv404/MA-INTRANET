import { conversationEvents, type ConversationEventRecord, type NewConversationEventRecord } from '../db/schema.js';

export class EventService {
  /**
   * Record a CRM event in conversation_events
   */
  public static async recordEvent(
    tx: any,
    data: NewConversationEventRecord
  ): Promise<ConversationEventRecord> {
    const inserted = await tx
      .insert(conversationEvents)
      .values({
        ...data,
        createdAt: new Date(),
      })
      .returning();

    return inserted[0]!;
  }
}
