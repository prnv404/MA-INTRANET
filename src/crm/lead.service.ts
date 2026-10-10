import type { DbClient } from '../db/index.js';
import type { Lead } from '../db/schema.js';

export class LeadService {
  /**
   * Ensure a customer has an active lead.
   * If they don't have one (or all are closed/lost/booked), create a new one.
   */
  public static async ensureActiveLead(
    db: DbClient,
    customerId: string,
    salesRepId?: string
  ): Promise<{ lead: Lead; isNew: boolean }> {
    // Look for an existing open lead for this customer
    const { data: existing, error: findError } = await db
      .from('leads')
      .select()
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .returns<Lead[]>();
    if (findError) throw findError;

    // Consider a lead "active" if it is not booked or lost
    const active = existing.find((lead) => lead.status !== 'booked' && lead.status !== 'lost');

    if (active) {
      // If we found an active lead, return it
      // Automatically update the sales rep to whoever is currently messaging them
      if (salesRepId && active.sales_rep_id !== salesRepId) {
        const { data: updated, error: updateError } = await db
          .from('leads')
          .update({ sales_rep_id: salesRepId, updated_at: new Date().toISOString() })
          .eq('lead_id', active.lead_id)
          .select()
          .single<Lead>();
        if (updateError) throw updateError;
        return { lead: updated, isNew: false };
      }
      return { lead: active, isNew: false };
    }

    // No active lead found, create a new one (ai_status defaults to 'active' in the DB)
    const now = new Date().toISOString();
    const { data: created, error: insertError } = await db
      .from('leads')
      .insert({
        customer_id: customerId,
        sales_rep_id: salesRepId || null,
        stage: 'new',
        status: 'interested',
        source_channel: 'whatsapp',
        created_at: now,
        updated_at: now,
      })
      .select()
      .single<Lead>();
    if (insertError) throw insertError;

    return { lead: created, isNew: true };
  }

  public static async findById(db: DbClient, leadId: string): Promise<Lead | null> {
    const { data, error } = await db
      .from('leads')
      .select()
      .eq('lead_id', leadId)
      .maybeSingle<Lead>();
    if (error) throw error;
    return data;
  }
}
