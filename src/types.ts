/**
 * Types and interfaces for the WhatsApp Message Interceptor
 */

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'poll'
  | 'protocol'
  | 'unknown';

export interface MessageSender {
  /** Raw JID string (e.g. 1234567890@s.whatsapp.net or 123456789@g.us) */
  jid: string;
  /** Extracted clean phone number or group ID */
  phoneNumber: string;
  /** Sender display name (pushName) if provided */
  pushName?: string;
  /** Whether the message originated from a group chat */
  isGroup: boolean;
  /** Group JID if isGroup is true */
  groupJid?: string;
  /** Participant JID in a group chat */
  participantJid?: string;
  /** WhatsApp LID if present */
  lidJid?: string;
}

export interface MediaMetadata {
  mimetype?: string;
  fileSizeBytes?: number;
  fileSizeFormatted?: string;
  fileName?: string;
  caption?: string;
  durationSeconds?: number;
  /** Base64 encoded media string (if audio/media downloading is enabled) */
  base64?: string;
  /** Saved local file path if media was downloaded to disk */
  savedPath?: string;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ReactionData {
  text: string;
  targetMessageId: string;
}

export interface MessageContent {
  type: MessageType;
  text?: string;
  media?: MediaMetadata;
  location?: LocationData;
  reaction?: ReactionData;
  quotedMessageId?: string;
  rawKeys?: string[];
}

export interface InterceptedMessage {
  id: string;
  timestamp: number;
  isoDate: string;
  fromMe: boolean;
  sender: MessageSender;
  content: MessageContent;
  /** Reference to original raw Baileys message (useful for downloading media/audio) */
  rawMessage?: any;
  /** Phone number of the connected local WhatsApp account (sales rep account) */
  accountPhone?: string;
}

export interface RemoteApiConfig {
  /** Target remote REST API endpoint URL */
  endpointUrl: string;
  /** Optional authentication API key or Bearer token */
  apiKey?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Simulation settings for demo mode */
  simulateLatencyMs?: number;
}

export interface InterceptorOptions {
  /** Directory path to save Baileys session multi-file auth credentials */
  authDir?: string;
  /** Whether to render QR code directly in the terminal */
  printQRInTerminal?: boolean;
  /** Ignore self-sent messages (fromMe = true) */
  ignoreFromMe?: boolean;
  /** Ignore WhatsApp status broadcast messages */
  ignoreStatusUpdates?: boolean;
  /** Ignore group chat messages (only process direct 1-on-1 customer DMs) */
  ignoreGroupMessages?: boolean;
  /** Ignore old historical messages sent prior to connection initialization */
  ignoreOldMessages?: boolean;
  /** Custom logging level for Baileys */
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** Automatically download incoming audio/media files (Buffer / Base64) */
  downloadMedia?: boolean;
  /** Save downloaded media files to a local directory (e.g. ./downloads) */
  saveMediaDir?: string;
}
