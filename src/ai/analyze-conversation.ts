import { getConversationContext } from '../conversations/context.js';
import { applyConversationUpdate } from '../conversations/state.js';
import { analyzeWithGemini } from './gemini.js';
import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { conversations, customers, whatsappContacts } from '../db/schema.js';

export async function analyzeConversationJob(conversationId: string, triggerMessageId: string) {
  try {
    // 1. Get Context
    const { contextStr, unprocessedMessages } = await getConversationContext(conversationId);

    if (unprocessedMessages.length === 0) {
      console.log(`ℹ️ [AI] No unprocessed text messages found for conversation ${conversationId}. Skipping AI analysis.`);
      return;
    }

    const inputMessageIds = unprocessedMessages.map((m: any) => m.messageId);

    // 1.5 Security Boundary: Verify AI Eligibility
    const convInfo = await db.query.conversations.findFirst({
      where: eq(conversations.conversationId, conversationId),
      with: {
        customer: {
          with: {
            whatsappContact: true
          }
        }
      }
    });

    if (!convInfo || !convInfo.customer || !convInfo.customer.whatsappContact) {
      console.log(`🛡️ [AI BOUNDARY] Conversation ${conversationId} is not linked to a WhatsApp contact. Skipping.`);
      return;
    }

    if (!convInfo.customer.whatsappContact.crmEnabled || !convInfo.customer.whatsappContact.aiEnabled) {
      console.log(`🛡️ [AI BOUNDARY] Contact ${convInfo.customer.whatsappContact.whatsappJid} has AI disabled. ABORTING AI JOB.`);
      return;
    }

    console.log(`🚀 [AI] Analyzing ${inputMessageIds.length} unprocessed message(s) for conversation ${conversationId}...`);

    // 2. Call Gemini
    const { data: analysis, model } = await analyzeWithGemini(contextStr);

    if (!analysis) {
      console.error(`❌ [AI] Gemini analysis returned null for conversation ${conversationId}.`);
      return;
    }

    // 3. Apply Update via DB Transaction
    await applyConversationUpdate(conversationId, analysis, triggerMessageId, inputMessageIds, model);
    
    console.log(`✅ [AI] Successfully processed analysis for conversation ${conversationId}. Lead Score: ${analysis.lead_score || 'N/A'}`);
  } catch (error) {
    console.error(`💥 [AI] Unhandled error during conversation analysis job for ${conversationId}:`, error);
  }
}
