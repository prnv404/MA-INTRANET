import { describe, test, expect } from 'bun:test';
import { formatTranscript, mergeLeadDetails, parseDbTimestamp, type LeadDetailFields } from '../src/ai/lead-details.js';

const emptyLead: LeadDetailFields = {
  travel_date: null,
  travel_date_text: null,
  guests: null,
  bedrooms: null,
  cruise_type: null,
  boat_category: null,
};

describe('AI lead details — merge & completion', () => {
  test('fills extracted fields and stays active while details are missing', () => {
    const { updates, complete } = mergeLeadDetails(emptyLead, { guests: 6, bedrooms: 3 });
    expect(updates).toEqual({ guests: 6, bedrooms: 3 });
    expect(complete).toBe(false);
  });

  test('never erases existing values for fields Gemini omitted', () => {
    const current = { ...emptyLead, guests: 6, cruise_type: 'overnight' as const };
    const { updates, merged } = mergeLeadDetails(current, { bedrooms: 3 });
    expect(updates).toEqual({ bedrooms: 3 });
    expect(merged.guests).toBe(6);
    expect(merged.cruise_type).toBe('overnight');
  });

  test('newer values overwrite older ones', () => {
    const current = { ...emptyLead, guests: 4 };
    const { merged } = mergeLeadDetails(current, { guests: 6 });
    expect(merged.guests).toBe(6);
  });

  test('completes once date, guests, bedrooms and cruise type are known', () => {
    const current = { ...emptyLead, guests: 6, bedrooms: 3 };
    const { complete } = mergeLeadDetails(current, { travel_date: '2026-12-20', cruise_type: 'overnight' });
    expect(complete).toBe(true);
  });

  test('a vague date (text only) does not complete the lead', () => {
    const { complete } = mergeLeadDetails(emptyLead, {
      travel_date_text: 'sometime in January',
      guests: 2,
      bedrooms: 1,
      cruise_type: 'day_cruise',
    });
    expect(complete).toBe(false);
  });

  test('boat category is optional for completion', () => {
    const { complete } = mergeLeadDetails(emptyLead, {
      travel_date: '2026-12-20',
      guests: 2,
      bedrooms: 1,
      cruise_type: 'day_cruise',
    });
    expect(complete).toBe(true);
  });
});

describe('AI lead details — transcript', () => {
  test('DB timestamps without timezone are parsed as UTC', () => {
    expect(parseDbTimestamp('2026-10-10T06:30:00').toISOString()).toBe('2026-10-10T06:30:00.000Z');
    expect(parseDbTimestamp('2026-10-10T06:30:00+00:00').toISOString()).toBe('2026-10-10T06:30:00.000Z');
  });

  test('formats messages with local weekday/time and speaker', () => {
    const transcript = formatTranscript(
      [
        { direction: 'inbound', message_text: 'Need a 2 bed boat this Saturday', message_timestamp: '2026-10-10T06:30:00' },
        { direction: 'outbound', message_text: 'Overnight or day cruise?', message_timestamp: '2026-10-10T06:31:00' },
      ],
      'Asia/Kolkata'
    );
    expect(transcript).toBe(
      '[Sat, 10 Oct 2026, 12:00] Customer: Need a 2 bed boat this Saturday\n' +
        '[Sat, 10 Oct 2026, 12:01] Sales rep: Overnight or day cruise?'
    );
  });
});
