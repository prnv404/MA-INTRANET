import { eq } from 'drizzle-orm';
import { customers, type Customer } from '../db/schema.js';

export class CustomerService {
  /**
   * Find an existing contact/customer by WhatsApp JID, or create a new one.
   * If an existing customer has a null/empty name and a pushName is provided,
   * it automatically updates the customer's name.
   */
  public static async findOrCreateCustomer(
    tx: any,
    whatsappJid: string,
    whatsappNumber: string,
    pushName?: string,
    timestamp: Date = new Date()
  ): Promise<{ customer: Customer; isNew: boolean }> {
    const existing = await tx
      .select()
      .from(customers)
      .where(eq(customers.whatsappJid, whatsappJid))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      const customer = existing[0];
      const updatedFields: Partial<Customer> = {
        lastContactAt: timestamp,
        updatedAt: new Date(),
      };

      // Automatically update customer name if currently null/empty and a pushName is received
      if (
        (!customer.name || customer.name.trim() === '') &&
        pushName &&
        pushName.trim() !== ''
      ) {
        updatedFields.name = pushName.trim();
      }

      const updated = await tx
        .update(customers)
        .set(updatedFields)
        .where(eq(customers.customerId, customer.customerId))
        .returning();

      return { customer: updated[0] || customer, isNew: false };
    }

    // Create new customer (defaults to CRM enabled lead)
    const created = await tx
      .insert(customers)
      .values({
        whatsappJid,
        whatsappNumber,
        contactType: 'customer',
        crmEnabled: true,
        name: pushName && pushName.trim() !== '' ? pushName.trim() : null,
        firstContactAt: timestamp,
        lastContactAt: timestamp,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return { customer: created[0]!, isNew: true };
  }

  /**
   * Administrative function to update contact classification
   * E.g., marking someone as a 'boat_owner' and removing them from CRM
   */
  public static async classifyContact(
    tx: any,
    customerId: string,
    contactType: 'unknown' | 'customer' | 'boat_owner' | 'friend' | 'personal' | 'ignored',
    crmEnabled: boolean
  ) {
    const [updated] = await tx
      .update(customers)
      .set({
        contactType,
        crmEnabled,
        updatedAt: new Date(),
      })
      .where(eq(customers.customerId, customerId))
      .returning();
      
    return updated;
  }

  /**
   * Explicitly update the name of a customer
   */
  public static async updateCustomerName(
    tx: any,
    customerId: string,
    name: string
  ): Promise<Customer | null> {
    const updated = await tx
      .update(customers)
      .set({
        name: name.trim(),
        updatedAt: new Date(),
      })
      .where(eq(customers.customerId, customerId))
      .returning();

    return updated[0] || null;
  }

  /**
   * Helper to deterministically extract customer name from conversational text
   * e.g., "My name is John Doe", "I am Sarah", "Name: Alex"
   */
  public static extractNameFromText(text?: string | null): string | null {
    if (!text) return null;
    const match =
      text.match(/(?:my name is|i am|this is|name:?)\s+([A-Za-z\s]{2,30})/i);

    if (match && match[1]) {
      const candidate = match[1].trim();
      const forbidden = ['looking', 'interested', 'here', 'a', 'the', 'sending', 'asking'];
      if (candidate && !forbidden.includes(candidate.toLowerCase())) {
        // Capitalize words cleanly
        return candidate
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      }
    }
    return null;
  }

  /**
   * Explicitly update last contact timestamp for a customer
   */
  public static async updateLastContact(
    tx: any,
    customerId: string,
    timestamp: Date = new Date()
  ): Promise<void> {
    await tx
      .update(customers)
      .set({
        lastContactAt: timestamp,
        updatedAt: new Date(),
      })
      .where(eq(customers.customerId, customerId));
  }
}
