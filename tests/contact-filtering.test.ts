import { expect, test, describe } from 'bun:test';
import { db } from '../src/db/index.js';
import { whatsappContacts, customers } from '../src/db/schema.js';
import { ContactService } from '../src/contacts/contact.service.js';
import { MessageHandler } from '../src/whatsapp/message-handler.js';
import { eq } from 'drizzle-orm';
import type { InterceptedMessage } from '../src/types.js';

describe('WhatsApp Contact Filtering & CRM Access Control', () => {

  const generateMockMessage = (jid: string, text: string): InterceptedMessage => {
    const phone = jid.split('@')[0]!;
    return {
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Math.floor(Date.now() / 1000),
      isoDate: new Date().toISOString(),
      fromMe: false,
      sender: {
        jid,
        phoneNumber: phone,
        pushName: 'Test User',
        isGroup: false,
      },
      content: {
        type: 'text',
        text,
      },
    };
  };

  test('Unknown contact - Should NOT enter CRM', async () => {
    const jid = `unknown-${Date.now()}@s.whatsapp.net`;
    const phone = jid.split('@')[0]!;
    await ContactService.getOrCreateWhatsAppContact(jid, phone, 'Unknown User');
    await ContactService.classifyContact(jid, 'unknown', false);

    const msg = generateMockMessage(jid, "Hello, I am new");
    const result = await MessageHandler.handleIncomingMessage(msg);
    
    // Should be filtered out
    expect(result.processed).toBe(false);
    expect(result.customerId).toBeUndefined();

    // Verify whatsapp_contacts record was created
    const contact = await db.query.whatsappContacts.findFirst({
      where: eq(whatsappContacts.whatsappJid, jid)
    });
    expect(contact).toBeDefined();
    expect(contact?.contactType).toBe('unknown');
    expect(contact?.crmEnabled).toBe(false);

    // Verify NO customer was created
    const customer = await db.query.customers.findFirst({
      where: eq(customers.whatsappNumber, phone)
    });
    expect(customer).toBeUndefined();
  });

  test('Friend contact - Should NOT enter CRM', async () => {
    const jid = `friend-${Date.now()}@s.whatsapp.net`;
    const phone = jid.split('@')[0]!;
    
    // Seed friend contact
    await ContactService.getOrCreateWhatsAppContact(jid, phone, 'My Friend');
    await ContactService.classifyContact(jid, 'friend', false);

    const msg = generateMockMessage(jid, "Hey buddy!");
    const result = await MessageHandler.handleIncomingMessage(msg);
    
    expect(result.processed).toBe(false);

    // Verify NO customer was created
    const customer = await db.query.customers.findFirst({
      where: eq(customers.whatsappNumber, phone)
    });
    expect(customer).toBeUndefined();
  });

  test('Customer contact - Should enter CRM', async () => {
    const jid = `customer-${Date.now()}@s.whatsapp.net`;
    const phone = jid.split('@')[0]!;
    
    // Seed customer contact
    await ContactService.getOrCreateWhatsAppContact(jid, phone, 'Valid Customer');
    await ContactService.classifyContact(jid, 'customer', true);

    const msg = generateMockMessage(jid, "I want to book a boat.");
    const result = await MessageHandler.handleIncomingMessage(msg);
    
    expect(result.processed).toBe(true);
    expect(result.customerId).toBeDefined();

    // Verify Customer has FK
    const customer = await db.query.customers.findFirst({
      where: eq(customers.customerId, result.customerId!)
    });
    expect(customer?.whatsappContactId).toBeDefined();
  });

  test('Classification Change - Unknown to Customer', async () => {
    const jid = `upgrade-${Date.now()}@s.whatsapp.net`;
    const phone = jid.split('@')[0]!;
    
    // Seed contact as unknown
    await ContactService.getOrCreateWhatsAppContact(jid, phone, 'Upgrade User');
    await ContactService.classifyContact(jid, 'unknown', false);

    // 1. Send as unknown
    const msg1 = generateMockMessage(jid, "Who are you?");
    const result1 = await MessageHandler.handleIncomingMessage(msg1);
    expect(result1.processed).toBe(false);

    // 2. Classify as customer
    await ContactService.classifyContact(jid, 'customer', true);

    // 3. Send again
    const msg2 = generateMockMessage(jid, "I want to buy.");
    const result2 = await MessageHandler.handleIncomingMessage(msg2);
    expect(result2.processed).toBe(true);
  });
});
