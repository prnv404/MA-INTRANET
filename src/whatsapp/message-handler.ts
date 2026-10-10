import { db } from '../db/index.js';
import type { InterceptedMessage, MessageType } from '../types.js';
import { CustomerService } from '../crm/customer.service.js';
import { MessageService } from '../crm/message.service.js';
import { SalesRepService } from '../crm/sales-rep.service.js';
import { LeadService } from '../crm/lead.service.js';
import { ExtractionService } from '../ai/extraction.service.js';
import type { DbMessageType, Direction, Lead, SalesRep, SenderType } from '../db/schema.js';

export class MessageHandler {
  /**
   * Main entrypoint to process an intercepted WhatsApp message
   */
  public static async handleIncomingMessage(intercepted: InterceptedMessage): Promise<{
    processed: boolean;
    isDuplicate: boolean;
    customerId?: string;
    messageId?: string;
    salesRepId?: string;
    leadId?: string;
  }> {
    const whatsappMsgId = intercepted.id;

    // Skip group chat messages for CRM lead tracking
    if (intercepted.sender.isGroup) {
      return { processed: false, isDuplicate: false };
    }

    // Fast idempotency check before doing any writes
    const duplicateExists = await MessageService.isDuplicate(db, whatsappMsgId);
    if (duplicateExists) {
      console.log(`ℹ️ [IDEMPOTENCY] Message ${whatsappMsgId} already exists in DB. Skipping duplicate processing.`);
      return { processed: false, isDuplicate: true };
    }

    const msgDate = new Date(intercepted.timestamp * 1000);
    const direction: Direction = intercepted.fromMe ? 'outbound' : 'inbound';
    const senderType: SenderType = intercepted.fromMe ? 'sales_rep' : 'customer';
    const messageType = this.mapMessageType(intercepted.content.type);
    const messageText = intercepted.content.text || intercepted.content.media?.caption || null;
    const mediaUrl = intercepted.content.media?.savedPath || null;
    const rawPhone = intercepted.sender.phoneNumber || intercepted.sender.jid;
    // Strip device index (e.g. 919876543210:4@s.whatsapp.net -> 919876543210)
    const phoneNumber = rawPhone.split(':')[0]!.split('@')[0]!.trim();
    const jid = intercepted.sender.jid;

    // Sequential Supabase calls (the Data API has no multi-statement transactions).
    // The unique constraint on messages.whatsapp_message_id guarantees idempotency.

    // 1. Find or Create Unified Contact (Customer table)
    // Only pass pushName for INBOUND messages to avoid setting business/rep name as customer name
    const customerName = intercepted.fromMe ? undefined : intercepted.sender.pushName;

    const { customer } = await CustomerService.findOrCreateCustomer(
      db,
      jid,
      phoneNumber,
      customerName,
      msgDate
    );

    // 2. Resolve Sales Rep (for outbound messages or account phone)
    let salesRep: SalesRep | null = null;
    if (intercepted.fromMe || intercepted.accountPhone) {
      const repPhone = intercepted.accountPhone || phoneNumber;
      const repName = intercepted.fromMe ? intercepted.sender.pushName : undefined;
      salesRep = await SalesRepService.findOrCreateSalesRep(db, repPhone, repName);
    }

    // 3. Auto-create or find active Lead for CRM-enabled customers
    let lead: Lead | null = null;
    if (customer.crm_enabled) {
      ({ lead } = await LeadService.ensureActiveLead(
        db,
        customer.customer_id,
        salesRep?.sales_rep_id
      ));
    }

    // 4. Save Raw WhatsApp Message (Saved for all contacts, even if crm_enabled=false)
    const savedMessage = await MessageService.saveMessage(db, {
      customer_id: customer.customer_id,
      whatsapp_message_id: whatsappMsgId,
      sender_type: senderType,
      direction,
      message_type: messageType,
      message_text: messageText,
      media_url: mediaUrl,
      message_timestamp: msgDate.toISOString(),
      raw_payload: intercepted,
      created_at: new Date().toISOString(),
    });

    if (!savedMessage) {
      console.log(`ℹ️ [IDEMPOTENCY] Message ${whatsappMsgId} was stored concurrently. Skipping duplicate.`);
      return { processed: false, isDuplicate: true };
    }

    console.log(`✅ [CRM PERSISTENCE] Successfully stored ${direction} message ${whatsappMsgId}`);
    console.log(`   └─ Contact: ${customer.whatsapp_number} [ID: ${customer.customer_id}] (CRM Enabled: ${customer.crm_enabled})`);
    if (salesRep) {
      console.log(`   └─ Assigned Sales Rep: ${salesRep.name} (${salesRep.phone}) [ID: ${salesRep.sales_rep_id}]`);
    }

    // 5. Hand inbound customer messages to the AI layer (debounced, runs in the background)
    if (lead && direction === 'inbound') {
      ExtractionService.schedule(lead);
    }

    return {
      processed: true,
      isDuplicate: false,
      customerId: customer.customer_id,
      messageId: savedMessage.message_id,
      salesRepId: salesRep?.sales_rep_id,
      leadId: lead?.lead_id,
    };
  }

  private static mapMessageType(type: MessageType): DbMessageType {
    switch (type) {
      case 'text': return 'text';
      case 'image': return 'image';
      case 'video': return 'video';
      case 'audio': return 'audio';
      case 'document': return 'document';
      case 'location': return 'location';
      case 'reaction': return 'reaction';
      case 'sticker': return 'sticker';
      default: return 'other';
    }
  }
}
