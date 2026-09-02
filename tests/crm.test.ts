import { describe, test, expect } from 'bun:test';
import { StateService } from '../src/crm/state.service.js';
import type { InterceptedMessage } from '../src/types.js';

describe('Phase 1 CRM Data Foundation — Unit Tests', () => {
  describe('Deterministic Requirements Parser (StateService)', () => {
    test('Extracts guest count and bedroom requirement from text', () => {
      const input = 'Hi, I need a 2 bedroom houseboat for 6 people';
      const extracted = StateService.extractRequirementsFromText(input);

      expect(extracted.hasUpdates).toBe(true);
      expect(extracted.bedroomsRequired).toBe(2);
      expect(extracted.guestCount).toBe(6);
    });

    test('Extracts boat type and budget requirement', () => {
      const input = 'Looking for a Deluxe boat with budget ₹15000';
      const extracted = StateService.extractRequirementsFromText(input);

      expect(extracted.hasUpdates).toBe(true);
      expect(extracted.boatType).toBe('deluxe');
      expect(extracted.budget).toBe('15000');
    });

    test('Extracts 15k shorthand budget notation', () => {
      const input = 'We want a premium houseboat, budget 20k';
      const extracted = StateService.extractRequirementsFromText(input);

      expect(extracted.hasUpdates).toBe(true);
      expect(extracted.boatType).toBe('premium');
      expect(extracted.budget).toBe('20000');
    });

    test('Returns hasUpdates false for generic text without parameters', () => {
      const input = 'Hello, can you send photos and location details?';
      const extracted = StateService.extractRequirementsFromText(input);

      expect(extracted.hasUpdates).toBe(false);
      expect(extracted.bedroomsRequired).toBeUndefined();
      expect(extracted.guestCount).toBeUndefined();
    });
  });

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
