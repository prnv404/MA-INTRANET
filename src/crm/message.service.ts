import { eq } from 'drizzle-orm';
import { messages, type MessageRecord, type NewMessageRecord } from '../db/schema.js';

export class MessageService {
  /**
   * Check if a message with the given WhatsApp message ID already exists (idempotency check)
   */
  public static async isDuplicate(
    tx: any,
    whatsappMessageId: string
  ): Promise<boolean> {
    const existing = await tx
      .select({ id: messages.messageId })
      .from(messages)
      .where(eq(messages.whatsappMessageId, whatsappMessageId))
      .limit(1);

    return existing.length > 0;
  }

  /**
   * Insert a new message into the messages table
   */
  public static async saveMessage(
    tx: any,
    data: NewMessageRecord
  ): Promise<MessageRecord> {
    const inserted = await tx
      .insert(messages)
      .values(data)
      .returning();

    return inserted[0]!;
  }
}
