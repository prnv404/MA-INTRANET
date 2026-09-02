import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  Browsers,
  type WASocket,
  type WAMessage,
  type MessageUpsertType,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import type {
  InterceptedMessage,
  InterceptorOptions,
  MessageContent,
  MessageSender,
  MessageType,
} from './types.js';

export class WhatsAppInterceptor extends EventEmitter {
  private socket: WASocket | null = null;
  private options: Required<InterceptorOptions>;
  private startTime: number;
  private isConnecting = false;

  constructor(options?: InterceptorOptions) {
    super();
    this.startTime = Math.floor(Date.now() / 1000);
    this.options = {
      authDir: options?.authDir || './auth_info_baileys',
      printQRInTerminal: options?.printQRInTerminal ?? true,
      ignoreFromMe: options?.ignoreFromMe ?? false,
      ignoreStatusUpdates: options?.ignoreStatusUpdates ?? true,
      ignoreGroupMessages: options?.ignoreGroupMessages ?? true,
      ignoreOldMessages: options?.ignoreOldMessages ?? true,
      logLevel: options?.logLevel || 'silent',
      downloadMedia: options?.downloadMedia ?? false,
      saveMediaDir: options?.saveMediaDir || './downloads',
    };
  }

  /**
   * Register callback listener for intercepted WhatsApp messages
   */
  public onMessage(callback: (message: InterceptedMessage) => void | Promise<void>): this {
    this.on('message', callback);
    return this;
  }

  /**
   * Start WhatsApp connection & listener
   */
  public async start(): Promise<void> {
    if (this.isConnecting || this.socket) {
      console.log('⚠️ Interceptor is already running or connecting.');
      return;
    }

    this.isConnecting = true;
    console.log('🚀 Initializing WhatsApp Message Interceptor (Baileys)...');

    const logger = pino({ level: this.options.logLevel });
    const { state, saveCreds } = await useMultiFileAuthState(this.options.authDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(`ℹ️ Using Baileys version ${version.join('.')}${isLatest ? ' (latest)' : ''}`);

    this.socket = makeWASocket({
      version,
      logger,
      auth: state,
      printQRInTerminal: false, // We use custom qrcode-terminal handling for full control
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false, // Disables setting user presence to 'Online', preserving mobile push notifications on your phone!
      syncFullHistory: false,    // Prevents taking over full history desktop sync priority
      shouldSyncHistoryMessage: () => false,
    });

    // --- FIX FOR NOTIFICATION BUG (Baileys Issue #2553) ---
    // Prevents Baileys from accidentally broadcasting an "online" presence 
    // when it receives partial credential updates, which stops phone notifications.
    const passThrough = this.socket.ev.emit.bind(this.socket.ev);
    this.socket.ev.emit = (event: any, data: any) => {
      if (event === 'creds.update' && data && data.me === undefined && state.creds.me) {
        console.log('🛡️ [PRESENCE FIX] Suppressed a partial creds.update from broadcasting online status.');
        return passThrough(event, { ...(data as object), me: state.creds.me });
      }
      return passThrough(event, data);
    };
    // ------------------------------------------------------

    // Save auth credentials automatically when updated
    this.socket.ev.on('creds.update', saveCreds);

    // Handle Connection State Updates
    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && this.options.printQRInTerminal) {
        console.log('\n📲 [ACTION REQUIRED] Scan this QR code with WhatsApp on your mobile phone:');
        console.log('   (Settings > Linked Devices > Link a Device)\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        this.isConnecting = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`🔌 Connection closed. Reason: ${lastDisconnect?.error?.message || statusCode || 'Unknown'}`);

        if (shouldReconnect) {
          console.log('🔄 Reconnecting to WhatsApp socket in 3 seconds...');
          setTimeout(() => {
            this.socket = null;
            this.start();
          }, 3000);
        } else {
          console.log('🛑 Session logged out. Clear the auth directory and restart to scan a new QR code.');
          this.emit('logout');
        }
      } else if (connection === 'open') {
        this.isConnecting = false;
        const userJid = this.socket?.user?.id || 'Unknown';
        console.log('\n✅ [CONNECTED] WhatsApp Message Interceptor is now active and monitoring messages!');
        console.log(`👤 Connected as Account JID: ${userJid}`);
        console.log('📡 Waiting for incoming WhatsApp messages...\n');
        
        // Force offline status to ensure mobile push notifications still work
        try {
          await this.socket?.sendPresenceUpdate('unavailable');
        } catch (e) {
          console.error('Failed to set presence to unavailable', e);
        }

        this.emit('connected', userJid);
      }
    });

    // Handle Incoming Messages Interception
    this.socket.ev.on('messages.upsert', async ({ messages, type }: { messages: WAMessage[]; type: MessageUpsertType }) => {
      if (type !== 'notify') return;

      for (const rawMessage of messages) {
        try {
          const intercepted = await this.processRawMessage(rawMessage);
          if (intercepted) {
            this.emit('message', intercepted);
          }
        } catch (err) {
          console.error('❌ Error processing intercepted message:', err);
        }
      }
    });
  }

  /**
   * Utility method to download raw binary media/audio Buffer of a message
   */
  public async downloadMedia(m: WAMessage): Promise<Buffer> {
    const buffer = await downloadMediaMessage(
      m,
      'buffer',
      {},
      {
        logger: pino({ level: 'silent' }) as any,
        reuploadRequest: (msg: any) => this.socket?.updateMediaMessage(msg) as any,
      }
    );
    return buffer as Buffer;
  }

  /**
   * Stop interceptor connection gracefully
   */
  public async stop(): Promise<void> {
    if (this.socket) {
      console.log('🛑 Stopping WhatsApp Interceptor...');
      this.socket.end(undefined);
      this.socket = null;
      this.isConnecting = false;
      console.log('👋 Interceptor stopped.');
    }
  }

  /**
   * Extract & normalize raw Baileys WAMessage into standard InterceptedMessage payload
   */
  private async processRawMessage(m: WAMessage): Promise<InterceptedMessage | null> {
    if (!m.message || !m.key) return null;

    const remoteJid = m.key.remoteJid || '';

    // Filter status broadcast updates if configured
    if (this.options.ignoreStatusUpdates && (remoteJid === 'status@broadcast' || remoteJid.includes('@broadcast'))) {
      return null;
    }

    // Filter group chat messages if configured
    const isGroup = remoteJid.endsWith('@g.us');
    if (this.options.ignoreGroupMessages && isGroup) {
      return null;
    }

    // Filter self messages if configured
    const fromMe = Boolean(m.key.fromMe);
    if (this.options.ignoreFromMe && fromMe) {
      return null;
    }

    // Timestamp processing & filtering
    const msgTimestamp = typeof m.messageTimestamp === 'number'
      ? m.messageTimestamp
      : (m.messageTimestamp as any)?.low || this.startTime;

    if (this.options.ignoreOldMessages && msgTimestamp < this.startTime - 30) {
      return null; // Skip historical messages delivered during initial connection sync
    }

    // Extract Sender Details (supporting WhatsApp LID vs Phone Number JIDs)
    const remoteJidAlt = (m.key as any).remoteJidAlt || '';
    const participantJid = m.key.participant || (isGroup ? undefined : remoteJid);
    const participantAlt = (m.key as any).participantAlt || '';

    // Collect all candidate JIDs associated with this message
    const jidCandidates = [
      participantAlt,
      remoteJidAlt,
      participantJid,
      remoteJid,
    ].filter(Boolean);

    // Prefer Phone Number JID (@s.whatsapp.net) over LID (@lid)
    const pnJid =
      jidCandidates.find((j) => j.endsWith('@s.whatsapp.net')) ||
      jidCandidates.find((j) => !j.endsWith('@lid') && !j.endsWith('@g.us')) ||
      jidCandidates[0] ||
      '';

    const lidJid = jidCandidates.find((j) => j.endsWith('@lid'));

    // Extract clean phone number digits
    const cleanPhone = pnJid.split('@')[0] || pnJid;
    const primaryJid = pnJid || participantJid || remoteJid;

    const sender: MessageSender = {
      jid: primaryJid,
      phoneNumber: cleanPhone,
      pushName: m.pushName || undefined,
      isGroup,
      groupJid: isGroup ? remoteJid : undefined,
      participantJid,
      lidJid,
    };

    // Extract Message Content & Media Metadata
    const content = this.extractMessageContent(m.message);

    // Skip empty protocol messages (like key distributions or edit history syncs)
    if (content.type === 'protocol' && !content.text && !content.reaction) {
      return null;
    }

    // Auto-download media if configured (ignoring image and audio downloads)
    if (this.options.downloadMedia && content.media && content.type !== 'image' && content.type !== 'audio') {
      try {
        const buffer = await this.downloadMedia(m);
        content.media.base64 = buffer.toString('base64');

        if (this.options.saveMediaDir) {
          await fs.mkdir(this.options.saveMediaDir, { recursive: true });
          const mimeExt = content.media.mimetype?.split('/')[1]?.split(';')[0] || 'bin';
          const fileName = `${m.key.id || Date.now()}.${mimeExt}`;
          const filePath = path.join(this.options.saveMediaDir, fileName);
          await fs.writeFile(filePath, buffer);
          content.media.savedPath = filePath;
        }
      } catch (err: any) {
        console.error(`⚠️ Failed to download media attachment (${content.type}):`, err?.message || err);
      }
    }

    const userJid = this.socket?.user?.id || '';
    const accountPhone = userJid.split(':')[0]?.split('@')[0] || undefined;

    return {
      id: m.key.id || `msg_${Date.now()}`,
      timestamp: msgTimestamp,
      isoDate: new Date(msgTimestamp * 1000).toISOString(),
      fromMe,
      sender,
      content,
      rawMessage: m,
      accountPhone,
    };
  }

  /**
   * Helper to unravel WhatsApp message container types (ephemeral, viewOnce, etc.)
   */
  private extractMessageContent(rawMsg: any): MessageContent {
    // Unwrap container wrapper messages
    const msg =
      rawMsg?.ephemeralMessage?.message ||
      rawMsg?.viewOnceMessage?.message ||
      rawMsg?.viewOnceMessageV2?.message ||
      rawMsg?.documentWithCaptionMessage?.message ||
      rawMsg;

    if (!msg) {
      return { type: 'unknown' };
    }

    const keys = Object.keys(msg);

    // 1. Text Message
    if (msg.conversation) {
      return {
        type: 'text',
        text: msg.conversation,
        rawKeys: keys,
      };
    }

    // 2. Extended Text Message (with formatting, links, mentions, quotes)
    if (msg.extendedTextMessage) {
      const ext = msg.extendedTextMessage;
      return {
        type: 'text',
        text: ext.text || '',
        quotedMessageId: ext.contextInfo?.stanzaId,
        rawKeys: keys,
      };
    }

    // 3. Image Message
    if (msg.imageMessage) {
      const img = msg.imageMessage;
      return {
        type: 'image',
        text: img.caption || undefined,
        media: {
          mimetype: img.mimetype || 'image/jpeg',
          fileSizeBytes: this.toNumber(img.fileLength),
          fileSizeFormatted: this.formatBytes(this.toNumber(img.fileLength)),
          caption: img.caption || undefined,
        },
        rawKeys: keys,
      };
    }

    // 4. Video Message
    if (msg.videoMessage) {
      const vid = msg.videoMessage;
      return {
        type: 'video',
        text: vid.caption || undefined,
        media: {
          mimetype: vid.mimetype || 'video/mp4',
          fileSizeBytes: this.toNumber(vid.fileLength),
          fileSizeFormatted: this.formatBytes(this.toNumber(vid.fileLength)),
          caption: vid.caption || undefined,
          durationSeconds: vid.seconds,
        },
        rawKeys: keys,
      };
    }

    // 5. Audio / Voice Note Message
    if (msg.audioMessage) {
      const aud = msg.audioMessage;
      return {
        type: 'audio',
        media: {
          mimetype: aud.mimetype || 'audio/ogg',
          fileSizeBytes: this.toNumber(aud.fileLength),
          fileSizeFormatted: this.formatBytes(this.toNumber(aud.fileLength)),
          durationSeconds: aud.seconds,
        },
        rawKeys: keys,
      };
    }

    // 6. Document Message
    if (msg.documentMessage) {
      const doc = msg.documentMessage;
      return {
        type: 'document',
        text: doc.caption || undefined,
        media: {
          fileName: doc.fileName || 'document',
          mimetype: doc.mimetype || 'application/octet-stream',
          fileSizeBytes: this.toNumber(doc.fileLength),
          fileSizeFormatted: this.formatBytes(this.toNumber(doc.fileLength)),
          caption: doc.caption || undefined,
        },
        rawKeys: keys,
      };
    }

    // 7. Sticker Message
    if (msg.stickerMessage) {
      const stk = msg.stickerMessage;
      return {
        type: 'sticker',
        media: {
          mimetype: stk.mimetype || 'image/webp',
          fileSizeBytes: this.toNumber(stk.fileLength),
          fileSizeFormatted: this.formatBytes(this.toNumber(stk.fileLength)),
        },
        rawKeys: keys,
      };
    }

    // 8. Location Message
    if (msg.locationMessage || msg.liveLocationMessage) {
      const loc = msg.locationMessage || msg.liveLocationMessage;
      return {
        type: 'location',
        text: loc.name || loc.address ? `${loc.name || ''} ${loc.address || ''}`.trim() : undefined,
        location: {
          latitude: loc.degreesLatitude || 0,
          longitude: loc.degreesLongitude || 0,
          name: loc.name || undefined,
          address: loc.address || undefined,
        },
        rawKeys: keys,
      };
    }

    // 9. Reaction Message
    if (msg.reactionMessage) {
      const react = msg.reactionMessage;
      return {
        type: 'reaction',
        reaction: {
          text: react.text || '',
          targetMessageId: react.key?.id || '',
        },
        rawKeys: keys,
      };
    }

    // 10. Contact Message
    if (msg.contactMessage || msg.contactsArrayMessage) {
      const contact = msg.contactMessage;
      return {
        type: 'contact',
        text: contact?.displayName ? `Contact: ${contact.displayName}` : 'Shared Contact',
        rawKeys: keys,
      };
    }

    // 11. Poll Message
    if (msg.pollCreationMessage || msg.pollCreationMessageV3) {
      const poll = msg.pollCreationMessage || msg.pollCreationMessageV3;
      return {
        type: 'poll',
        text: poll?.name || 'Poll',
        rawKeys: keys,
      };
    }

    // 12. Protocol Message (e.g., delete for everyone / revocation)
    if (msg.protocolMessage) {
      return {
        type: 'protocol',
        rawKeys: keys,
      };
    }

    return {
      type: 'unknown',
      rawKeys: keys,
    };
  }

  private toNumber(val: any): number | undefined {
    if (typeof val === 'number') return val;
    if (val && typeof val.toNumber === 'function') return val.toNumber();
    if (val && typeof val.low === 'number') return val.low;
    return undefined;
  }

  private formatBytes(bytes?: number): string | undefined {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return undefined;
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
