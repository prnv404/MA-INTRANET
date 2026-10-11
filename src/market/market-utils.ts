// Pure helpers for the market (group availability) pipeline — no DB / network access.
import { createHash } from 'node:crypto';
import type { MarketTripType } from '../db/schema.js';

export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';

/** A newer post only supersedes listings last seen more than this long before it (burst posts) */
export const SUPERSEDE_GRACE_MS = 15 * 60 * 1000;
/** "Now" / "available at 5 pm" listings stay live this long after the stated time */
export const TIMED_LISTING_TTL_MS = 4 * 60 * 60 * 1000;
/** Undated demand posts stay open this long */
export const UNDATED_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize WhatsApp text: NFKC turns "𝗙𝗶𝘃𝗲 𝗯𝗲𝗱" (math bold) into "Five bed",
 * strips invisible direction marks and collapses whitespace.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t  ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Messages that carry no availability information at all */
export function isSkippableText(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return true;
  if (/^(this message was deleted|you deleted this message)\.?$/i.test(t)) return true;
  if (/^(image|video|audio|sticker|document|gif|contact card) omitted$/i.test(t)) return true;
  return false;
}

/**
 * Cache key for parse results. Includes the posting date (IST) because
 * "Today"/"Tomorrow" resolve differently on different days.
 */
export function textHash(normalizedText: string, postedAt: Date): string {
  return createHash('sha256')
    .update(`${istDateOf(postedAt)}\n${normalizedText.toLowerCase()}`)
    .digest('hex');
}

/** Indian mobile numbers in the text, as 10 digits ("+91 88489 99589", "09207159269" → 8848999589, 9207159269) */
export function extractPhones(text: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:\+?91[\s-]?)?0?[6-9](?:[\s-]?\d){9}/g;
  for (const match of normalizeText(text).matchAll(pattern)) {
    const digits = match[0].replace(/\D/g, '').slice(-10);
    if (/^[6-9]\d{9}$/.test(digits)) found.add(digits);
  }
  return [...found];
}

/** Extract 10-digit Indian phone from a WhatsApp JID like "919876543210@s.whatsapp.net" */
export function phoneFromJid(jid: string | undefined | null): string | null {
  if (!jid) return null;
  const match = jid.match(/^91(\d{10})@/);
  return match?.[1] ?? null;
}

/** YYYY-MM-DD of an instant in IST */
export function istDateOf(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last second of an IST calendar day */
export function istEndOfDay(ymd: string): Date {
  return new Date(`${ymd}T23:59:59${IST_OFFSET}`);
}

/** "Mon, 20 Jul 2026, 07:57" in IST — gives the model the weekday for "Saturday" etc. */
export function formatIst(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Parse a clock time like "5 pm", "4.30pm", "3:00 PM" on an IST date.
 * Without am/pm, 1–7 is read as afternoon (houseboat check-ins are 11 am–5 pm).
 */
export function parseClockTime(value: string, ymd: string): Date | null {
  const match = value.toLowerCase().match(/(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3];
  if (hour > 23 || minute > 59) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${ymd}T${hh}:${mm}:00${IST_OFFSET}`);
}

/**
 * Expiry rules:
 * - dated listing → end of that day (IST)
 * - "now" → 4 h after the post
 * - "available at 5 pm" → 4 h after that time (or after the post, if later)
 * Never later than the end of the listing's day.
 */
export function computeListingExpiry(args: { date: string; availableFrom?: string | null; postedAt: Date }): Date {
  const endOfDay = istEndOfDay(args.date);
  const from = args.availableFrom?.trim().toLowerCase();
  if (!from) return endOfDay;

  let base: Date;
  if (/\bnow\b/.test(from)) {
    base = args.postedAt;
  } else {
    const time = parseClockTime(from, args.date);
    if (!time) return endOfDay;
    base = time > args.postedAt ? time : args.postedAt;
  }

  const expiry = new Date(base.getTime() + TIMED_LISTING_TTL_MS);
  return expiry < endOfDay ? expiry : endOfDay;
}

/** Demand posts: end of the needed day, or 24 h after the post when no date is given */
export function computeRequestExpiry(args: { date?: string | null; postedAt: Date }): Date {
  if (args.date) return istEndOfDay(args.date);
  return new Date(args.postedAt.getTime() + UNDATED_REQUEST_TTL_MS);
}

/** Identity of a listing within one operator + date (matches the DB unique constraint) */
export function listingKey(bedrooms: number, tripType: MarketTripType): string {
  return `${bedrooms}|${tripType}`;
}

export function unionArrays<T>(a: readonly T[] | null | undefined, b: readonly T[] | null | undefined): T[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

/** True when the date is within the window a group post can sensibly refer to */
export function isPlausibleDate(ymd: string, postedAt: Date, maxDaysAhead = 180): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || Number.isNaN(new Date(`${ymd}T00:00:00Z`).getTime())) return false;
  const today = istDateOf(postedAt);
  return ymd >= today && ymd <= addDays(today, maxDaysAhead);
}
