import { eq } from 'drizzle-orm';
import { salesReps, type SalesRep } from '../db/schema.js';

export class SalesRepService {
  /**
   * Find a sales rep by their WhatsApp phone number
   */
  public static async findSalesRepByPhone(
    tx: any,
    phone: string
  ): Promise<SalesRep | null> {
    const cleanPhone = phone.split(':')[0]!.split('@')[0]!.trim();
    const existing = await tx
      .select()
      .from(salesReps)
      .where(eq(salesReps.phone, cleanPhone))
      .limit(1);

    return existing[0] || null;
  }

  /**
   * Find an existing sales rep or create a new one by phone number
   */
  public static async findOrCreateSalesRep(
    tx: any,
    phone: string,
    name?: string
  ): Promise<SalesRep> {
    const cleanPhone = phone.split(':')[0]!.split('@')[0]!.trim();
    const existing = await this.findSalesRepByPhone(tx, cleanPhone);

    if (existing) {
      if (!existing.name && name) {
        const updated = await tx
          .update(salesReps)
          .set({ name, updatedAt: new Date() })
          .where(eq(salesReps.salesRepId, existing.salesRepId))
          .returning();
        return updated[0] || existing;
      }
      return existing;
    }

    const created = await tx
      .insert(salesReps)
      .values({
        phone: cleanPhone,
        name: name || `Sales Rep (${cleanPhone})`,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created[0]!;
  }
}
