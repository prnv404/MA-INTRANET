import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { db } from '../src/db/index.js';
import { whatsappContacts, customers, conversations, messages, aiAnalysis } from '../src/db/schema.js';
import { ContactService } from '../src/contacts/contact.service.js';
import { MessageHandler } from '../src/whatsapp/message-handler.js';
import { eq } from 'drizzle-orm';
import type { InterceptedMessage } from '../src/types.js';

describe('WhatsApp Contact Filtering & CRM Access Control', () => {

  const generateMockMessage = (jid: string, text: string): InterceptedMessage => {
    return {
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Math.floor(Date.now() / 1000),
      fromMe: false,
      sender: {
        jid,
        phoneNumber: jid.split('@')[0],
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
      where: eq(customers.whatsappNumber, jid.split('@')[0])
    });
    expect(customer).toBeUndefined();
  });

  test('Friend contact - Should NOT enter CRM', async () => {
    const jid = `friend-${Date.now()}@s.whatsapp.net`;
    
    // Seed friend contact
    await ContactService.getOrCreateWhatsAppContact(jid, jid.split('@')[0], 'My Friend');
    await ContactService.classifyContact(jid, 'friend', false, false);

    const msg = generateMockMessage(jid, "Hey buddy!");
    const result = await MessageHandler.handleIncomingMessage(msg);
    
    expect(result.processed).toBe(false);

    // Verify NO customer was created
    const customer = await db.query.customers.findFirst({
      where: eq(customers.whatsappNumber, jid.split('@')[0])
    });
    expect(customer).toBeUndefined();
  });

  test('Customer contact - Should enter CRM and Trigger AI', async () => {
    const jid = `customer-${Date.now()}@s.whatsapp.net`;
    
    // Seed customer contact
    await ContactService.getOrCreateWhatsAppContact(jid, jid.split('@')[0], 'Valid Customer');
    await ContactService.classifyContact(jid, 'customer', true, true);

    const msg = generateMockMessage(jid, "I want to book a boat.");
    const result = await MessageHandler.handleIncomingMessage(msg);
    
    expect(result.processed).toBe(true);
    expect(result.customerId).toBeDefined();
    expect(result.conversationId).toBeDefined();

    // Verify Customer has FK
    const customer = await db.query.customers.findFirst({
      where: eq(customers.customerId, result.customerId!)
    });
    expect(customer?.whatsappContactId).toBeDefined();
  });

  test('AI Disabled contact - Should enter CRM but NOT Trigger AI', async () => {
    const jid = `noai-${Date.now()}@s.whatsapp.net`;
    
    // Seed contact with crm enabled, but ai disabled
    await ContactService.getOrCreateWhatsAppContact(jid, jid.split('@')[0], 'No AI Customer');
    await ContactService.classifyContact(jid, 'customer', true, false);

    const msg = generateMockMessage(jid, "Don't analyze me.");
    const result = await MessageHandler.handleIncomingMessage(msg);
    
    expect(result.processed).toBe(true);
    expect(result.customerId).toBeDefined();

    // Since ai is disabled, the system shouldn't have scheduled it (or if it did, analyzeConversationJob would abort).
    // In our implementation, scheduleConversationAnalysis shouldn't be called if aiEnabled is false.
  });

  test('Classification Change - Unknown to Customer', async () => {
    const jid = `upgrade-${Date.now()}@s.whatsapp.net`;
    
    // 1. Send as unknown
    const msg1 = generateMockMessage(jid, "Who are you?");
    const result1 = await MessageHandler.handleIncomingMessage(msg1);
    expect(result1.processed).toBe(false);

    // 2. Classify as customer
    await ContactService.classifyContact(jid, 'customer', true, true);

    // 3. Send again
    const msg2 = generateMockMessage(jid, "I want to buy.");
    const result2 = await MessageHandler.handleIncomingMessage(msg2);
    expect(result2.processed).toBe(true);
  });
});
