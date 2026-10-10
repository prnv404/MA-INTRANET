import { UNIQUE_VIOLATION, type DbClient } from '../db/index.js';
import type { MessageRecord, NewMessageRecord } from '../db/schema.js';

export class MessageService {
  /**
   * Check if a message with the given WhatsApp message ID already exists (idempotency check)
   */
  public static async isDuplicate(
    db: DbClient,
    whatsappMessageId: string
  ): Promise<boolean> {
    const { data, error } = await db
      .from('messages')
      .select('message_id')
      .eq('whatsapp_message_id', whatsappMessageId)
      .limit(1);
    if (error) throw error;

    return data.length > 0;
  }

  /**
   * Insert a new message into the messages table.
   * Returns null if a message with the same whatsapp_message_id already exists.
   */
  public static async saveMessage(
    db: DbClient,
    data: NewMessageRecord
  ): Promise<MessageRecord | null> {
    const { data: inserted, error } = await db
      .from('messages')
      .insert(data)
      .select()
      .single<MessageRecord>();

    if (error?.code === UNIQUE_VIOLATION) return null;
    if (error) throw error;

    return inserted;
  }
}
