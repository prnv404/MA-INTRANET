import { expect, test, describe } from 'bun:test';
import { db } from '../src/db/index.js';
import { customers } from '../src/db/schema.js';
import { CustomerService } from '../src/crm/customer.service.js';
import { MessageHandler } from '../src/whatsapp/message-handler.js';
import { eq } from 'drizzle-orm';
import type { InterceptedMessage } from '../src/types.js';

describe('Unified Contacts & Message Handling', () => {

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

  test('New inbound message creates a unified contact with CRM enabled by default', async () => {
    const jid = `newlead-${Date.now()}@s.whatsapp.net`;
    const phone = jid.split('@')[0]!;

    const msg = generateMockMessage(jid, "I want to book a houseboat");
    const result = await MessageHandler.handleIncomingMessage(msg);
    
    // Should be processed and saved
    expect(result.processed).toBe(true);
    expect(result.customerId).toBeDefined();

    // Verify contact record was created
    const contact = await db.query.customers.findFirst({
      where: eq(customers.whatsappJid, jid)
    });
    expect(contact).toBeDefined();
    expect(contact?.contactType).toBe('customer');
    expect(contact?.crmEnabled).toBe(true);
  });

  test('Boat owner message is processed but crmEnabled can be set to false', async () => {
    const jid = `boatowner-${Date.now()}@s.whatsapp.net`;
    const phone = jid.split('@')[0]!;
    
    // 1. Manually seed contact as a boat owner
    await db.transaction(async (tx) => {
      await CustomerService.findOrCreateCustomer(tx, jid, phone, 'Boat Owner');
      const contact = await db.query.customers.findFirst({ where: eq(customers.whatsappJid, jid) });
      await CustomerService.classifyContact(tx, contact!.customerId, 'boat_owner', false);
    });

    // 2. Send message
    const msg = generateMockMessage(jid, "Boat is ready");
    const result = await MessageHandler.handleIncomingMessage(msg);
    
    // Message is still processed and saved in the DB (for history)
    expect(result.processed).toBe(true);
    expect(result.customerId).toBeDefined();

    // Verify customer is still a boat owner and crm is disabled
    const contact = await db.query.customers.findFirst({
      where: eq(customers.whatsappJid, jid)
    });
    expect(contact?.contactType).toBe('boat_owner');
    expect(contact?.crmEnabled).toBe(false);
  });

  test('Group messages are ignored completely', async () => {
    const jid = `group-${Date.now()}@g.us`;
    const msg = generateMockMessage(jid, "Hello group");
    msg.sender.isGroup = true;

    const result = await MessageHandler.handleIncomingMessage(msg);
    expect(result.processed).toBe(false);
  });
});
