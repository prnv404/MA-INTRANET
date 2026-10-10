import type { DbClient } from '../db/index.js';
import type { SalesRep } from '../db/schema.js';

export class SalesRepService {
  /**
   * Find a sales rep by their WhatsApp phone number
   */
  public static async findSalesRepByPhone(
    db: DbClient,
    phone: string
  ): Promise<SalesRep | null> {
    const cleanPhone = phone.split(':')[0]!.split('@')[0]!.trim();
    const { data, error } = await db
      .from('sales_reps')
      .select()
      .eq('phone', cleanPhone)
      .limit(1)
      .returns<SalesRep[]>();
    if (error) throw error;

    return data[0] || null;
  }

  /**
   * Find an existing sales rep or create a new one by phone number
   */
  public static async findOrCreateSalesRep(
    db: DbClient,
    phone: string,
    name?: string
  ): Promise<SalesRep> {
    const cleanPhone = phone.split(':')[0]!.split('@')[0]!.trim();
    const existing = await this.findSalesRepByPhone(db, cleanPhone);

    if (existing) {
      if (!existing.name && name) {
        const { data: updated, error } = await db
          .from('sales_reps')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('sales_rep_id', existing.sales_rep_id)
          .select()
          .maybeSingle<SalesRep>();
        if (error) throw error;
        return updated || existing;
      }
      return existing;
    }

    const now = new Date().toISOString();
    const { data: created, error } = await db
      .from('sales_reps')
      .insert({
        phone: cleanPhone,
        name: name || `Sales Rep (${cleanPhone})`,
        active: true,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single<SalesRep>();
    if (error) throw error;

    return created;
  }
}
