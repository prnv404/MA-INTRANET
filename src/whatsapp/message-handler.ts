import { db } from '../db/index.js';
import type { InterceptedMessage, MessageType } from '../types.js';
import { CustomerService } from '../crm/customer.service.js';
import { MessageService } from '../crm/message.service.js';
import { SalesRepService } from '../crm/sales-rep.service.js';
import { OpportunityService } from '../crm/opportunity.service.js';
import type { SalesRep } from '../db/schema.js';

export class MessageHandler {
  /**
   * Main entrypoint to process an intercepted WhatsApp message transactionally
   */
  public static async handleIncomingMessage(intercepted: InterceptedMessage): Promise<{
    processed: boolean;
    isDuplicate: boolean;
    customerId?: string;
    messageId?: string;
    salesRepId?: string;
  }> {
    const whatsappMsgId = intercepted.id;

    // Skip group chat messages for CRM lead tracking
    if (intercepted.sender.isGroup) {
      return { processed: false, isDuplicate: false };
    }

    // Fast idempotency check before opening transaction
    const duplicateExists = await MessageService.isDuplicate(db, whatsappMsgId);
    if (duplicateExists) {
      console.log(`ℹ️ [IDEMPOTENCY] Message ${whatsappMsgId} already exists in DB. Skipping duplicate processing.`);
      return { processed: false, isDuplicate: true };
    }

    const msgDate = new Date(intercepted.timestamp * 1000);
    const direction = intercepted.fromMe ? 'outbound' : 'inbound';
    const senderType = intercepted.fromMe ? 'sales_rep' : 'customer';
    const messageType = this.mapMessageType(intercepted.content.type);
    const messageText = intercepted.content.text || intercepted.content.media?.caption || null;
    const mediaUrl = intercepted.content.media?.savedPath || null;
    const rawPhone = intercepted.sender.phoneNumber || intercepted.sender.jid;
    // Strip device index (e.g. 919876543210:4@s.whatsapp.net -> 919876543210)
    const phoneNumber = rawPhone.split(':')[0]!.split('@')[0]!.trim();
    const jid = intercepted.sender.jid;

    // Atomic Database Transaction
    const result = await db.transaction(async (tx) => {
      // 1. Idempotency double-check within transaction
      const isStillDuplicate = await MessageService.isDuplicate(tx, whatsappMsgId);
      if (isStillDuplicate) {
        return { processed: false, isDuplicate: true };
      }

      // 2. Find or Create Unified Contact (Customer table)
      // Only pass pushName for INBOUND messages to avoid setting business/rep name as customer name
      const customerName = intercepted.fromMe ? undefined : intercepted.sender.pushName;
      
      const { customer } = await CustomerService.findOrCreateCustomer(
        tx,
        jid,
        phoneNumber,
        customerName,
        msgDate
      );

      // If customer.name is still missing, attempt text extraction (e.g., "My name is John")
      if (!customer.name && messageText && direction === 'inbound') {
        const extractedName = CustomerService.extractNameFromText(messageText);
        if (extractedName) {
          const updated = await CustomerService.updateCustomerName(tx, customer.customerId, extractedName);
          if (updated) {
            customer.name = updated.name;
          }
        }
      }

      // 3. Resolve Sales Rep (for outbound messages or account phone)
      let salesRep: SalesRep | null = null;
      if (intercepted.fromMe || intercepted.accountPhone) {
        const repPhone = intercepted.accountPhone || phoneNumber;
        const repName = intercepted.fromMe ? intercepted.sender.pushName : undefined;
        salesRep = await SalesRepService.findOrCreateSalesRep(tx, repPhone, repName);
      }

      // 3.5 Auto-create or find active Opportunity for CRM-enabled customers on inbound messages
      if (direction === 'inbound' && customer.crmEnabled) {
        await OpportunityService.ensureActiveOpportunity(
          tx,
          customer.customerId,
          salesRep?.salesRepId
        );
      }

      // 4. Save Raw WhatsApp Message (Saved for all contacts, even if crmEnabled=false)
      const savedMessage = await MessageService.saveMessage(tx, {
        customerId: customer.customerId,
        whatsappMessageId: whatsappMsgId,
        senderType,
        direction,
        messageType,
        messageText,
        mediaUrl,
        messageTimestamp: msgDate,
        rawPayload: intercepted as any,
        createdAt: new Date(),
      });

      console.log(`✅ [CRM PERSISTENCE] Successfully stored ${direction} message ${whatsappMsgId}`);
      console.log(`   └─ Contact: ${customer.whatsappNumber} [ID: ${customer.customerId}] (CRM Enabled: ${customer.crmEnabled})`);
      if (salesRep) {
        console.log(`   └─ Assigned Sales Rep: ${salesRep.name} (${salesRep.phone}) [ID: ${salesRep.salesRepId}]`);
      }

      return {
        processed: true,
        isDuplicate: false,
        customerId: customer.customerId,
        messageId: savedMessage.messageId,
        salesRepId: salesRep?.salesRepId,
      };
    });

    return result;
  }

  private static mapMessageType(type: MessageType): 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'reaction' | 'sticker' | 'other' {
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
