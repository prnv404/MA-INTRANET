import { describe, test, expect } from 'bun:test';
import type { InterceptedMessage } from '../src/types.js';

describe('Phase 1 CRM Data Foundation — Unit Tests', () => {
  describe('Intercepted Message Payload Format', () => {
    test('Constructs valid InterceptedMessage structure', () => {
      const sampleMsg: InterceptedMessage = {
        id: 'MSG_123456789',
        timestamp: Math.floor(Date.now() / 1000),
        isoDate: new Date().toISOString(),
        fromMe: false,
        sender: {
          jid: '919876543210@s.whatsapp.net',
          phoneNumber: '919876543210',
          pushName: 'Alice',
          isGroup: false,
        },
        content: {
          type: 'text',
          text: 'Hello, looking for a 3 bedroom houseboat for 8 guests',
        },
      };

      expect(sampleMsg.id).toBe('MSG_123456789');
      expect(sampleMsg.sender.phoneNumber).toBe('919876543210');
      expect(sampleMsg.content.type).toBe('text');
    });
  });
});
