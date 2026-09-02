import { eq, and } from 'drizzle-orm';
import { conversations, type Conversation } from '../db/schema.js';

export class ConversationService {
  /**
   * Find an active conversation for a customer
   */
  public static async findActiveConversation(
    tx: any,
    customerId: string
  ): Promise<Conversation | null> {
    const active = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.customerId, customerId),
          eq(conversations.status, 'active')
        )
      )
      .limit(1);

    return active[0] || null;
  }

  /**
   * Create a new sales conversation for a customer
   */
  public static async createConversation(
    tx: any,
    customerId: string,
    timestamp: Date = new Date(),
    channel: 'whatsapp' | 'website' | 'instagram' | 'phone' | 'other' = 'whatsapp',
    assignedSalesRepId?: string | null
  ): Promise<Conversation> {
    const created = await tx
      .insert(conversations)
      .values({
        customerId,
        assignedSalesRepId: assignedSalesRepId || null,
        channel,
        status: 'active',
        leadStage: 'new',
        firstMessageAt: timestamp,
        lastMessageAt: timestamp,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created[0]!;
  }

  /**
   * Assign or reassign a sales rep to a conversation
   */
  public static async assignSalesRep(
    tx: any,
    conversationId: string,
    salesRepId: string
  ): Promise<Conversation | null> {
    const updated = await tx
      .update(conversations)
      .set({
        assignedSalesRepId: salesRepId,
        updatedAt: new Date(),
      })
      .where(eq(conversations.conversationId, conversationId))
      .returning();

    return updated[0] || null;
  }

  /**
   * Update the last_message_at timestamp for a conversation
   */
  public static async updateLastMessageAt(
    tx: any,
    conversationId: string,
    timestamp: Date = new Date()
  ): Promise<void> {
    await tx
      .update(conversations)
      .set({
        lastMessageAt: timestamp,
        updatedAt: new Date(),
      })
      .where(eq(conversations.conversationId, conversationId));
  }
}
