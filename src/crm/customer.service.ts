import { UNIQUE_VIOLATION, type DbClient } from '../db/index.js';
import type { Customer, WhatsappContactType } from '../db/schema.js';

export class CustomerService {
  /**
   * Find an existing contact/customer by WhatsApp JID, or create a new one.
   * If an existing customer has a null/empty name and a pushName is provided,
   * it automatically updates the customer's name.
   */
  public static async findOrCreateCustomer(
    db: DbClient,
    whatsappJid: string,
    whatsappNumber: string,
    pushName?: string,
    timestamp: Date = new Date()
  ): Promise<{ customer: Customer; isNew: boolean }> {
    const { data: existing, error: findError } = await db
      .from('customers')
      .select()
      .eq('whatsapp_jid', whatsappJid)
      .maybeSingle<Customer>();
    if (findError) throw findError;

    if (existing) {
      const updatedFields: Partial<Customer> = {
        last_contact_at: timestamp.toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Automatically update customer name if currently null/empty and a pushName is received
      if (
        (!existing.name || existing.name.trim() === '') &&
        pushName &&
        pushName.trim() !== ''
      ) {
        updatedFields.name = pushName.trim();
      }

      const { data: updated, error: updateError } = await db
        .from('customers')
        .update(updatedFields)
        .eq('customer_id', existing.customer_id)
        .select()
        .maybeSingle<Customer>();
      if (updateError) throw updateError;

      return { customer: updated || existing, isNew: false };
    }

    // Create new customer (defaults to CRM enabled lead)
    const now = new Date().toISOString();
    const { data: created, error: insertError } = await db
      .from('customers')
      .insert({
        whatsapp_jid: whatsappJid,
        whatsapp_number: whatsappNumber,
        contact_type: 'customer',
        crm_enabled: true,
        name: pushName && pushName.trim() !== '' ? pushName.trim() : null,
        first_contact_at: timestamp.toISOString(),
        last_contact_at: timestamp.toISOString(),
        created_at: now,
        updated_at: now,
      })
      .select()
      .single<Customer>();

    // Lost a race with a concurrent insert — fall back to the now-existing row
    if (insertError?.code === UNIQUE_VIOLATION) {
      return this.findOrCreateCustomer(db, whatsappJid, whatsappNumber, pushName, timestamp);
    }
    if (insertError) throw insertError;

    return { customer: created, isNew: true };
  }

  /**
   * Administrative function to update contact classification
   * E.g., marking someone as a 'boat_owner' and removing them from CRM
   */
  public static async classifyContact(
    db: DbClient,
    customerId: string,
    contactType: WhatsappContactType,
    crmEnabled: boolean
  ): Promise<Customer | null> {
    const { data: updated, error } = await db
      .from('customers')
      .update({
        contact_type: contactType,
        crm_enabled: crmEnabled,
        updated_at: new Date().toISOString(),
      })
      .eq('customer_id', customerId)
      .select()
      .maybeSingle<Customer>();
    if (error) throw error;

    return updated;
  }

  /**
   * Explicitly update last contact timestamp for a customer
   */
  public static async updateLastContact(
    db: DbClient,
    customerId: string,
    timestamp: Date = new Date()
  ): Promise<void> {
    const { error } = await db
      .from('customers')
      .update({
        last_contact_at: timestamp.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('customer_id', customerId);
    if (error) throw error;
  }
}
