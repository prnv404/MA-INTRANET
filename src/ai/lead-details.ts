// Pure helpers for the AI extraction layer (no DB / network access, unit-testable).
import type { Lead } from '../db/schema.js';
import type { TripDetails } from './extractor.js';

/** Fields that must all be filled before the AI layer switches off for a lead */
export const REQUIRED_FIELDS = ['travel_date', 'guests', 'bedrooms', 'cruise_type'] as const;

export type LeadDetailFields = Pick<
  Lead,
  'travel_date' | 'travel_date_text' | 'guests' | 'bedrooms' | 'cruise_type' | 'boat_category'
>;

export interface TranscriptMessage {
  direction: 'inbound' | 'outbound';
  message_text: string;
  message_timestamp: string;
}

/**
 * DB columns are `timestamp without time zone` holding UTC values, so the API
 * returns them without a "Z". Parse them as UTC rather than local time.
 */
export function parseDbTimestamp(value: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
}

/**
 * Render messages as a transcript with local date/weekday per line,
 * so Gemini can resolve relative dates like "this Saturday".
 */
export function formatTranscript(messages: TranscriptMessage[], timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return messages
    .map((m) => {
      const who = m.direction === 'inbound' ? 'Customer' : 'Sales rep';
      return `[${fmt.format(parseDbTimestamp(m.message_timestamp))}] ${who}: ${m.message_text}`;
    })
    .join('\n');
}

/**
 * Merge extracted details into the lead. Fields Gemini didn't return are left
 * untouched (never erased); returned fields overwrite, since the AI sees the
 * whole conversation and reports the latest value.
 */
export function mergeLeadDetails(
  current: LeadDetailFields,
  extracted: TripDetails
): { updates: Partial<LeadDetailFields>; merged: LeadDetailFields; complete: boolean } {
  const updates: Partial<LeadDetailFields> = {};
  if (extracted.travel_date !== undefined) updates.travel_date = extracted.travel_date;
  if (extracted.travel_date_text !== undefined) updates.travel_date_text = extracted.travel_date_text;
  if (extracted.guests !== undefined) updates.guests = extracted.guests;
  if (extracted.bedrooms !== undefined) updates.bedrooms = extracted.bedrooms;
  if (extracted.cruise_type !== undefined) updates.cruise_type = extracted.cruise_type;
  if (extracted.boat_category !== undefined) updates.boat_category = extracted.boat_category;

  const merged = { ...current, ...updates };
  const complete = REQUIRED_FIELDS.every((field) => merged[field] !== null && merged[field] !== undefined);

  return { updates, merged, complete };
}
