import { db } from '../db/index.js';
import type { InterceptedMessage, MessageType } from '../types.js';
import { CustomerService } from '../crm/customer.service.js';
import { ConversationService } from '../crm/conversation.service.js';
import { MessageService } from '../crm/message.service.js';
import { EventService } from '../crm/event.service.js';
import { StateService } from '../crm/state.service.js';
import { SalesRepService } from '../crm/sales-rep.service.js';
import { scheduleConversationAnalysis } from '../workers/conversation-analysis.js';
import { ContactService } from '../contacts/contact.service.js';
import type { SalesRep } from '../db/schema.js';

export class MessageHandler {
  /**
   * Main entrypoint to process an intercepted WhatsApp message transactionally
   */
  public static async handleIncomingMessage(intercepted: InterceptedMessage): Promise<{
    processed: boolean;
    isDuplicate: boolean;
    customerId?: string;
    conversationId?: string;
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

    // ==========================================
    // DATA BOUNDARY & CONTACT FILTERING
    // ==========================================
    const contact = await ContactService.getOrCreateWhatsAppContact(
      jid,
      phoneNumber,
      intercepted.fromMe ? undefined : intercepted.sender.pushName
    );

    if (!contact.crmEnabled) {
      console.log(`🛡️ [CONTACT FILTER] Contact ${jid} (Type: ${contact.contactType}) is not CRM-enabled. Stopping processing.`);
      return { processed: false, isDuplicate: false };
    }

    // Atomic Database Transaction
    const result = await db.transaction(async (tx) => {
      // 1. Idempotency double-check within transaction
      const isStillDuplicate = await MessageService.isDuplicate(tx, whatsappMsgId);
      if (isStillDuplicate) {
        return { processed: false, isDuplicate: true };
      }

      // 2. Find or Create Customer (only pass pushName for INBOUND messages to avoid setting business/rep name as customer name)
      const customerName = intercepted.fromMe ? undefined : intercepted.sender.pushName;
      const { customer, isNew: isNewCustomer } = await CustomerService.findOrCreateCustomer(
        tx,
        phoneNumber,
        customerName,
        msgDate,
        contact.id
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

      // 4. Find or Create Active Conversation
      let conversation = await ConversationService.findActiveConversation(tx, customer.customerId);
      let isNewConversation = false;

      if (!conversation) {
        conversation = await ConversationService.createConversation(
          tx,
          customer.customerId,
          msgDate,
          'whatsapp',
          salesRep?.salesRepId || null
        );
        isNewConversation = true;

        // Record lead_created event for new conversation
        await EventService.recordEvent(tx, {
          conversationId: conversation.conversationId,
          eventType: 'lead_created',
          eventData: {
            source: 'whatsapp',
            firstMessageText: messageText,
            isNewCustomer,
            assignedSalesRepId: salesRep?.salesRepId || null,
          },
          performedByType: direction === 'inbound' ? 'customer' : 'sales_rep',
          performedById: direction === 'inbound' ? customer.customerId : salesRep?.salesRepId,
          eventTimestamp: msgDate,
        });
      } else {
        // Assign/Update Sales Rep on existing conversation if not yet set or sent by a sales rep
        if (salesRep && (!conversation.assignedSalesRepId || intercepted.fromMe)) {
          await ConversationService.assignSalesRep(tx, conversation.conversationId, salesRep.salesRepId);
          conversation.assignedSalesRepId = salesRep.salesRepId;
        }

        // Update conversation last_message_at
        await ConversationService.updateLastMessageAt(tx, conversation.conversationId, msgDate);
      }

      // Update customer last_contact_at
      await CustomerService.updateLastContact(tx, customer.customerId, msgDate);

      // 5. Save Raw WhatsApp Message
      const savedMessage = await MessageService.saveMessage(tx, {
        conversationId: conversation.conversationId,
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

      // 6. Record Message Event (message_received for inbound, message_sent for outbound)
      const eventType = direction === 'inbound' ? 'message_received' : 'message_sent';
      await EventService.recordEvent(tx, {
        conversationId: conversation.conversationId,
        eventType,
        eventData: {
          messageId: savedMessage.messageId,
          whatsappMessageId: whatsappMsgId,
          messageType,
          text: messageText,
          salesRepId: salesRep?.salesRepId || null,
        },
        performedByType: direction === 'inbound' ? 'customer' : 'sales_rep',
        performedById: direction === 'inbound' ? customer.customerId : salesRep?.salesRepId,
        eventTimestamp: msgDate,
      });

      // 7. Deterministic Requirements State Extraction (NO AI)
      const { updated: stateUpdated, extracted } = await StateService.updateStateDeterministic(
        tx,
        conversation.conversationId,
        messageText
      );

      if (stateUpdated) {
        await EventService.recordEvent(tx, {
          conversationId: conversation.conversationId,
          eventType: 'requirement_collected',
          eventData: {
            extractedRequirements: extracted,
            triggerMessageId: savedMessage.messageId,
          },
          performedByType: 'system',
          eventTimestamp: msgDate,
        });
      }

      console.log(`✅ [CRM PERSISTENCE] Successfully stored ${direction} message ${whatsappMsgId}`);
      console.log(`   └─ Customer: ${customer.whatsappNumber} | Conversation: ${conversation.conversationId} ${isNewConversation ? '(NEW LEAD)' : ''}`);
      if (salesRep) {
        console.log(`   └─ Assigned Sales Rep: ${salesRep.name} (${salesRep.phone}) [ID: ${salesRep.salesRepId}]`);
      }

      return {
        processed: true,
        isDuplicate: false,
        customerId: customer.customerId,
        conversationId: conversation.conversationId,
        messageId: savedMessage.messageId,
        salesRepId: salesRep?.salesRepId,
      };
    });

    if (result.processed && result.conversationId && result.messageId) {
      // AI layer temporarily disabled for MVP
      // if (contact.aiEnabled) {
      //   scheduleConversationAnalysis(result.conversationId, result.messageId);
      // }
      console.log(`🛡️ [AI DISABLED] AI conversation analysis is temporarily turned off for MVP.`);
    }

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
