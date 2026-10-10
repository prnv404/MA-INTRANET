import { describe, test, expect } from 'bun:test';
import {
  computeListingExpiry,
  computeRequestExpiry,
  extractPhones,
  isPlausibleDate,
  isSkippableText,
  istDateOf,
  normalizeText,
  parseClockTime,
  textHash,
} from '../src/market/market-utils.js';
import { parseChatExport } from '../src/market/chat-export.js';
import { sanitizeParsedPost } from '../src/market/group-parser.js';

const LRM = '‎';
const at = (iso: string) => new Date(iso);

describe('market utils — text', () => {
  test('normalizes math-bold text and invisible marks', () => {
    expect(normalizeText('𝗙𝗶𝘃𝗲 𝗯𝗲𝗱 𝗿𝗼𝗼𝗺 𝗽𝗿𝗲𝗺𝗶𝘂𝗺')).toBe('Five bed room premium');
    expect(normalizeText(`${LRM}Today  2 bed\n\n  available `)).toBe('Today 2 bed\navailable');
  });

  test('extracts Indian mobile numbers in all the formats groups use', () => {
    expect(extractPhones('Contact +91 88489 99589')).toEqual(['8848999589']);
    expect(extractPhones('*75608 34844*')).toEqual(['7560834844']);
    expect(extractPhones('09207159269')).toEqual(['9207159269']);
    expect(extractPhones('9447411639  9388111639')).toEqual(['9447411639', '9388111639']);
    expect(extractPhones('94471 67363. 8848418722')).toEqual(['9447167363', '8848418722']);
    expect(extractPhones('Tomorrow 20/07/26 Rs 7000 only')).toEqual([]);
  });

  test('skips empty, deleted and attachment-only posts', () => {
    expect(isSkippableText('Hi')).toBe(true);
    expect(isSkippableText('This message was deleted')).toBe(true);
    expect(isSkippableText('Sharing available today')).toBe(false);
  });

  test('parse cache key differs per posting day (Today/Tomorrow are relative)', () => {
    const text = 'today 2 bed available';
    expect(textHash(text, at('2026-10-09T08:00:00+05:30'))).toBe(textHash('Today 2 bed available', at('2026-10-09T20:00:00+05:30')));
    expect(textHash(text, at('2026-10-09T08:00:00+05:30'))).not.toBe(textHash(text, at('2026-10-10T08:00:00+05:30')));
  });
});

describe('market utils — dates & expiry', () => {
  test('IST date of late-evening UTC instants', () => {
    expect(istDateOf(at('2026-10-09T19:00:00Z'))).toBe('2026-10-10'); // 00:30 IST next day
  });

  test('parses houseboat clock times (no am/pm → afternoon)', () => {
    expect(parseClockTime('5 pm', '2026-10-10')?.toISOString()).toBe('2026-10-10T11:30:00.000Z');
    expect(parseClockTime('4.30pm', '2026-10-10')?.toISOString()).toBe('2026-10-10T11:00:00.000Z');
    expect(parseClockTime('3', '2026-10-10')?.toISOString()).toBe('2026-10-10T09:30:00.000Z');
  });

  test('dated listing expires at end of its IST day', () => {
    const exp = computeListingExpiry({ date: '2026-10-11', postedAt: at('2026-10-10T08:00:00+05:30') });
    expect(exp.toISOString()).toBe('2026-10-11T18:29:59.000Z');
  });

  test('"now" listing expires 4 h after the post', () => {
    const exp = computeListingExpiry({ date: '2026-10-10', availableFrom: 'now', postedAt: at('2026-10-10T12:00:00+05:30') });
    expect(exp.toISOString()).toBe('2026-10-10T10:30:00.000Z'); // 16:00 IST
  });

  test('"available at 5 pm" expires 4 h after 5 pm, capped at end of day', () => {
    expect(
      computeListingExpiry({ date: '2026-10-10', availableFrom: '5 pm', postedAt: at('2026-10-10T09:00:00+05:30') }).toISOString()
    ).toBe('2026-10-10T15:30:00.000Z'); // 21:00 IST
    expect(
      computeListingExpiry({ date: '2026-10-10', availableFrom: 'now', postedAt: at('2026-10-10T22:00:00+05:30') }).toISOString()
    ).toBe('2026-10-10T18:29:59.000Z');
  });

  test('demand expiry: needed day, or 24 h when undated', () => {
    expect(computeRequestExpiry({ date: '2026-10-20', postedAt: at('2026-10-10T08:00:00+05:30') }).toISOString()).toBe('2026-10-20T18:29:59.000Z');
    expect(computeRequestExpiry({ postedAt: at('2026-10-10T08:00:00Z') }).toISOString()).toBe('2026-10-11T08:00:00.000Z');
  });

  test('plausible dates: not in the past, not too far ahead', () => {
    const posted = at('2026-10-10T08:00:00+05:30');
    expect(isPlausibleDate('2026-10-10', posted)).toBe(true);
    expect(isPlausibleDate('2026-10-09', posted)).toBe(false);
    expect(isPlausibleDate('2027-12-01', posted)).toBe(false);
    expect(isPlausibleDate('2026-13-01', posted)).toBe(false);
  });
});

describe('group parser — sanitizing model output', () => {
  test('keeps valid items, drops bad ones and past dates', () => {
    const result = sanitizeParsedPost(
      {
        kind: 'supply',
        listings: [
          { date: '2026-10-10', bedrooms: 4, trip_type: 'overnight', category: 'premium' },
          { date: '2026-10-01', bedrooms: 2, trip_type: 'overnight' }, // past
          { date: '2026-10-11', bedrooms: 99, trip_type: 'overnight' }, // impossible
          { date: '2026-10-11', bedrooms: 2, trip_type: 'cruise' }, // bad enum
        ],
        requests: [{ pax: 6, trip_type: 'day_cruise', date: '2020-01-01' }],
      },
      at('2026-10-10T08:00:00+05:30')
    );
    expect(result.kind).toBe('supply');
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]!.bedrooms).toBe(4);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]!.date).toBeUndefined();
  });

  test('garbage output becomes noise', () => {
    expect(sanitizeParsedPost(null, new Date())).toEqual({ kind: 'noise', listings: [], requests: [] });
  });
});

describe('chat export parser', () => {
  const sample = [
    `[5/8/24, 9:36:53 AM] KEDARAM  House Boat: ${LRM}Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.`,
    `[7/19/26, 6:15:30 PM] Sirajudheen Hb: Nightstay avilabile`,
    `2 bedroom `,
    `Uppdeck `,
    `Contact 9447186890`,
    `${LRM}[7/19/26, 7:33:54 PM] ~ yesudasjoseph1963: ${LRM}video omitted`,
    `${LRM}[7/20/26, 7:23:32 AM] ~ vishak: 1 bed room available ${LRM}image omitted`,
    `[7/20/26, 10:15:46 AM] ~ 🕸️: ${LRM}This message was deleted.`,
    `[8/5/26, 7:01:36 AM] Pearls Spot Hb: *Today SHARING ROOMS available*`,
    `7558831555 ${LRM}<This message was edited>`,
    `[9/18/26, 12:09:50 PM] ~ shambhu: ${LRM}~ Noufal added ~ shambhu`,
  ].join('\n');

  const messages = parseChatExport(sample);

  test('joins multi-line posts and reads times as IST', () => {
    const siraj = messages[1]!;
    expect(siraj.sender).toBe('Sirajudheen Hb');
    expect(siraj.text).toBe('Nightstay avilabile\n2 bedroom \nUppdeck \nContact 9447186890');
    expect(siraj.postedAt.toISOString()).toBe('2026-07-19T12:45:30.000Z');
    expect(siraj.isSystem).toBe(false);
  });

  test('flags system lines, pure attachments and deletes; keeps captions', () => {
    expect(messages[0]!.isSystem).toBe(true); // encryption notice
    expect(messages[2]!.isSystem).toBe(true); // video omitted
    expect(messages[3]!.text).toBe('1 bed room available');
    expect(messages[3]!.isSystem).toBe(false);
    expect(messages[3]!.sender).toBe('vishak');
    expect(messages[4]!.isSystem).toBe(true); // deleted
    expect(messages[6]!.isSystem).toBe(true); // "added"
  });

  test('strips the edited marker', () => {
    expect(messages[5]!.isEdited).toBe(true);
    expect(messages[5]!.text.endsWith('7558831555')).toBe(true);
  });
});
