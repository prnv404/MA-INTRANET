import { eq, desc } from 'drizzle-orm';
import { opportunities, type Opportunity, type NewOpportunity } from '../db/schema.js';

export class OpportunityService {
  /**
   * Ensure a customer has an active opportunity.
   * If they don't have one (or all are closed/lost/booked), create a new one.
   */
  public static async ensureActiveOpportunity(
    tx: any,
    customerId: string,
    salesRepId?: string
  ): Promise<{ opportunity: Opportunity; isNew: boolean }> {
    // Look for an existing open opportunity for this customer
    const existing = await tx
      .select()
      .from(opportunities)
      .where(eq(opportunities.customerId, customerId))
      .orderBy(desc(opportunities.createdAt));

    // Consider an opportunity "active" if it is not booked or lost
    const active = existing.find((opp: Opportunity) => opp.status !== 'booked' && opp.status !== 'lost');

    if (active) {
      // If we found an active opportunity, return it
      // Optionally update the sales rep if one is provided and none is currently assigned
      if (salesRepId && !active.salesRepId) {
        const [updated] = await tx
          .update(opportunities)
          .set({ salesRepId, updatedAt: new Date() })
          .where(eq(opportunities.opportunityId, active.opportunityId))
          .returning();
        return { opportunity: updated, isNew: false };
      }
      return { opportunity: active, isNew: false };
    }

    // No active opportunity found, create a new one
    const [created] = await tx
      .insert(opportunities)
      .values({
        customerId,
        salesRepId: salesRepId || null,
        stage: 'new',
        status: 'interested',
        sourceChannel: 'whatsapp',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return { opportunity: created, isNew: true };
  }
}
