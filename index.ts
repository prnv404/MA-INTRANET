import { WhatsAppInterceptor } from './src/interceptor.js';
import { MessageHandler } from './src/whatsapp/message-handler.js';
import { ExtractionService } from './src/ai/extraction.service.js';
import { MarketService } from './src/market/market.service.js';

async function main() {
  console.clear();
  console.log('===========================================================');
  console.log('   🟢 INTELLIGENT WHATSAPP CRM — DATA FOUNDATION (PHASE 1) ');
  console.log('===========================================================\n');

  // 1. Initialize WhatsApp Interceptor
  const interceptor = new WhatsAppInterceptor({
    authDir: './auth_info_baileys',
    printQRInTerminal: true,
    ignoreFromMe: false,        // Intercept messages from both self & contacts
    ignoreStatusUpdates: true,  // Ignore WhatsApp status story broadcasts
    ignoreGroupMessages: false, // Groups feed the live boat availability board (only enabled groups are read)
    ignoreOldMessages: true,    // Ignore past historical messages on boot
    logLevel: 'silent',         // Keep terminal clean for interceptor output
    downloadMedia: false,       // Disabled media binary downloading
  });

  // 2. Connect Interceptor to CRM Transactional Persistence Layer
  interceptor.onMessage(async (interceptedMessage) => {
    // B2B owner groups → market availability pipeline (queued, never blocks DMs)
    if (interceptedMessage.sender.isGroup) {
      if (!interceptedMessage.fromMe && interceptedMessage.sender.groupJid) {
        void MarketService.enqueue(MarketService.fromIntercepted(interceptedMessage));
      }
      return;
    }

    try {
      await MessageHandler.handleIncomingMessage(interceptedMessage);
    } catch (err) {
      console.error('❌ [CRM PIPELINE ERROR] Failed to process message:', err);
    }
  });

  // 3. Handle Connection Lifecycle Events
  interceptor.on('connected', (jid) => {
    console.log(`💡 [STATUS] Interceptor online for JID: ${jid}`);
    console.log('💬 Monitoring WhatsApp messages & persisting to Supabase CRM...\n');
  });

  interceptor.on('logout', () => {
    console.log('🛑 WhatsApp session was logged out. Exiting application.');
    process.exit(0);
  });

  // 4. Handle Graceful Process Shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down WhatsApp Interceptor...`);
    ExtractionService.cancelAll();
    await interceptor.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 5. Start Interceptor Connection
  await interceptor.start();
}

main().catch((err) => {
  console.error('💥 Unhandled error in main application:', err);
  process.exit(1);
});