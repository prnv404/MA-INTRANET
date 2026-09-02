import { db } from '../db/index.js';
import { whatsappContacts } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export class ContactService {
  /**
   * Retrieves an existing WhatsApp contact by JID or creates a new one 
   * defaulting to 'unknown' type with CRM and AI disabled.
   */
  public static async getOrCreateWhatsAppContact(
    jid: string,
    phoneNumber: string,
    displayName?: string
  ) {
    const existing = await db.query.whatsappContacts.findFirst({
      where: eq(whatsappContacts.whatsappJid, jid),
    });

    if (existing) {
      return existing;
    }

    // Create a new contact if it doesn't exist
    const [newContact] = await db.insert(whatsappContacts).values({
      whatsappJid: jid,
      phoneNumber,
      displayName,
      contactType: 'customer',
      crmEnabled: true,
      aiEnabled: true,
    }).onConflictDoNothing({ target: whatsappContacts.whatsappJid }).returning();

    // In case of a race condition where onConflictDoNothing prevented insert,
    // fetch the existing record again.
    if (!newContact) {
      const raceContact = await db.query.whatsappContacts.findFirst({
        where: eq(whatsappContacts.whatsappJid, jid),
      });
      if (!raceContact) {
         throw new Error(`Failed to create or retrieve WhatsApp contact for ${jid}`);
      }
      return raceContact;
    }

    return newContact;
  }

  /**
   * Administrative function to update contact classification
   */
  public static async classifyContact(
    jid: string,
    contactType: 'unknown' | 'customer' | 'boat_owner' | 'friend' | 'personal' | 'ignored',
    crmEnabled: boolean,
    aiEnabled: boolean
  ) {
    const [updated] = await db
      .update(whatsappContacts)
      .set({
        contactType,
        crmEnabled,
        aiEnabled,
        updatedAt: new Date(),
      })
      .where(eq(whatsappContacts.whatsappJid, jid))
      .returning();
      
    return updated;
  }
}
