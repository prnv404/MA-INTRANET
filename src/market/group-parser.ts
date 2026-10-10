import { z } from 'zod';
import { getGeminiClient } from '../ai/gemini.js';
import { formatIst, isPlausibleDate } from './market-utils.js';

const tripType = z.enum(['day_cruise', 'overnight', 'day_or_overnight', 'sharing', 'unknown']);
const category = z.enum(['deluxe', 'premium', 'luxury']);

const listingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Available date as YYYY-MM-DD.'),
  bedrooms: z.number().int().min(0).max(30).describe('Bedrooms of the boat; 0 if not stated (e.g. "sharing rooms available").'),
  boat_count: z.number().int().min(1).max(10).optional().describe('How many boats of this size, e.g. "2*2*5 bed" -> two 2-bed boats.'),
  trip_type: tripType,
  category: category.optional(),
  upper_deck: z.boolean().optional(),
  ac: z.boolean().optional(),
  glass_covered: z.boolean().optional(),
  capacity_pax: z.number().int().min(1).max(500).optional().describe('Passenger capacity if stated, e.g. "50 pax capacity".'),
  available_from: z.string().optional().describe('"now" or a clock time like "5 pm" if the boat is only free from then.'),
  boat_name: z.string().optional().describe('Boat or brand name if stated, e.g. "KOMBAN", "FIONA", "Hail Mary".'),
});

const requestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Needed date as YYYY-MM-DD, if determinable.'),
  date_text: z.string().optional().describe('The date as written, e.g. "Sep 9", "വരുന്ന ശനിയാഴ്ച".'),
  pax: z.number().int().min(1).max(500).optional(),
  bedrooms: z.number().int().min(1).max(30).optional(),
  trip_type: tripType,
  category: category.optional(),
  party_type: z.string().optional().describe('e.g. "family", "bachelors", "couple".'),
  notes: z.string().optional().describe('Other requirements in English, e.g. "AC", "with lunch", "boat race view".'),
});

const groupPostSchema = z.object({
  kind: z.enum(['supply', 'demand', 'noise']).describe('supply = boats offered, demand = someone needs a boat, noise = anything else.'),
  listings: z.array(listingSchema),
  requests: z.array(requestSchema),
});

export type ParsedListing = z.infer<typeof listingSchema>;
export type ParsedRequest = z.infer<typeof requestSchema>;
export interface ParsedGroupPost {
  kind: 'supply' | 'demand' | 'noise';
  listings: ParsedListing[];
  requests: ParsedRequest[];
}

const SYSTEM_INSTRUCTION = `You read posts from WhatsApp groups of houseboat operators and agents in Alappuzha (Alleppey), Kerala.
Owners post which boats are free ("supply"); agents post what they need ("demand"). Turn each post into structured data.

DATES (use the "Posted" timestamp, Asia/Kolkata):
- "Today", "Now", "Night stay" with no date, "today night" -> the posting date. "Tomorrow" / "നാളെ" -> posting date + 1.
- Weekday names ("Saturday", "ശനി") -> the next such day on or after the posting date.
- "20/07/26", "20.9.2026", "Oct 4", "1st Oct", "August 15", "15 th Saturday" -> that date (DD/MM order). Fix obvious year typos (e.g. 2025 or 3026 when the post is clearly about this month).
- Several dates ("24,25,26", "TODAY & TOMORROW", "Saturday Sunday") -> repeat the listings for each date.
- Omit dates that are impossible or already past.

BEDROOMS (one listing per bedroom size per date):
- "3.4.5.6.bed", "3,5,6,8,10,12 Bed", "1&3bed", "1b & 2b & 6b", "2/3 bedroom" -> one listing each size.
- "2*2*5 BED" / "2*5 BED" (Hail Mary style) -> sizes multiplied: "2*2*5" = two 2-bed boats (boat_count 2) and one 5-bed.
- "single bed", "one bedroom", "1bhk" -> 1. "two bed" -> 2. "3 BEDROOM (1 to 3 rooms)" -> one 3-bed boat.
- "Sharing rooms available" -> trip_type "sharing", bedrooms = boat size if stated ("sharing rooms in 6 bedroom" -> 6) else 0.

TRIP TYPE: "day cruise"/"day trip"/"daycruise" -> day_cruise; "night stay"/"overnight"/"nightstay" -> overnight; both mentioned -> day_or_overnight; sharing rooms -> sharing; not stated -> unknown.
FEATURES: "upper deck"/"upperduck"/"upd" -> upper_deck true ("non upperdeck" -> false); "glass covered" -> glass_covered; "A/c", "ac" -> ac; premium/primium, deluxe/dlx/dulux, luxury/luxuery -> category.
TIME: "available for 5 pm", "4.30pm", "at 3pm" -> available_from "5 pm" etc.; "NOW" -> available_from "now".

DEMAND: "Need", "Required", "Requirement", "rate please", "@" or "?" asking for a rate, Malayalam requests -> kind "demand".
"7 pax", "10 paks", "40 പേര്" -> pax. "bachelors"/"ബാച്ചിലർ", "family" -> party_type.

NOISE: scam/prize links, ads for other services, condolences, boats for sale, greetings, locations, questions about services -> kind "noise", empty arrays.

Ignore phone numbers and links. A post can have both listings and requests; kind is the main purpose. Never invent details that are not in the post.`;

/** Few-shot examples from real group posts */
const EXAMPLES: Array<{ posted: string; text: string; output: ParsedGroupPost }> = [
  {
    posted: 'Mon, 20 Jul 2026, 07:57',
    text: 'HAIL MARY HOUSE BOATS 🏕️2*2*5⛴️BED UPPER DECK GLASS COVERED PREMIUM AVAILABLE 🤙\n9961871122',
    output: {
      kind: 'supply',
      listings: [
        { date: '2026-07-20', bedrooms: 2, boat_count: 2, trip_type: 'unknown', category: 'premium', upper_deck: true, glass_covered: true, boat_name: 'Hail Mary' },
        { date: '2026-07-20', bedrooms: 5, boat_count: 1, trip_type: 'unknown', category: 'premium', upper_deck: true, glass_covered: true, boat_name: 'Hail Mary' },
      ],
      requests: [],
    },
  },
  {
    posted: 'Tue, 21 Jul 2026, 13:29',
    text: '*TODAY NIGHT STAY Boats are available*\n\n*Tomorrow SHARING ROOMS available*\n\n*Tomorrow 3,5,6 Bed Upper deck available for overnight or Day trip*\n\n7559031555',
    output: {
      kind: 'supply',
      listings: [
        { date: '2026-07-21', bedrooms: 0, trip_type: 'overnight' },
        { date: '2026-07-22', bedrooms: 0, trip_type: 'sharing' },
        { date: '2026-07-22', bedrooms: 3, trip_type: 'day_or_overnight', upper_deck: true },
        { date: '2026-07-22', bedrooms: 5, trip_type: 'day_or_overnight', upper_deck: true },
        { date: '2026-07-22', bedrooms: 6, trip_type: 'day_or_overnight', upper_deck: true },
      ],
      requests: [],
    },
  },
  {
    posted: 'Mon, 27 Jul 2026, 14:48',
    text: 'Today 2 bed upper deck house boat available for 5 pm',
    output: {
      kind: 'supply',
      listings: [{ date: '2026-07-27', bedrooms: 2, trip_type: 'unknown', upper_deck: true, available_from: '5 pm' }],
      requests: [],
    },
  },
  {
    posted: 'Sun, 26 Jul 2026, 15:25',
    text: 'Required Tomorrow \n6 pax Overnight \n3 bedroom \nRate \n\n7356574194',
    output: { kind: 'demand', listings: [], requests: [{ date: '2026-07-27', date_text: 'Tomorrow', pax: 6, bedrooms: 3, trip_type: 'overnight' }] },
  },
  {
    posted: 'Tue, 21 Jul 2026, 20:55',
    text: 'വരുന്ന ശനിയാഴ്ച 40 പേര് ഡേ ക്രൂയിസ്  1 pm to 5 pm \n Without lunch  only tea and snacks',
    output: {
      kind: 'demand',
      listings: [],
      requests: [{ date: '2026-07-25', date_text: 'വരുന്ന ശനിയാഴ്ച', pax: 40, trip_type: 'day_cruise', notes: '1 pm to 5 pm, without lunch, only tea and snacks' }],
    },
  },
  {
    posted: 'Sat, 19 Sep 2026, 17:06',
    text: 'TOMORROW  20.9.2026\n       SUNDAY\n\n1BED ROOM UPPERDEK PREMIUM BOAT AVAILABLE\n\n21.9.2026.MONDAY\n\n2BED ROOM UPPERDEK PREMIUM BOAT AVAILABLE\n\n94471 67363',
    output: {
      kind: 'supply',
      listings: [
        { date: '2026-09-20', bedrooms: 1, trip_type: 'unknown', category: 'premium', upper_deck: true },
        { date: '2026-09-21', bedrooms: 2, trip_type: 'unknown', category: 'premium', upper_deck: true },
      ],
      requests: [],
    },
  },
  {
    posted: 'Fri, 25 Sep 2026, 19:37',
    text: 'Google Pay 9-ാം വാർഷിക സമ്മാനം ₹6,000\nഇവിടെ ക്ലെയിം ചെയ്യൂ 👇\nhttps://gsll.corss.top/FV1zicpsl',
    output: { kind: 'noise', listings: [], requests: [] },
  },
];

function formatPost(posted: string, text: string): string {
  return `Posted: ${posted} (Asia/Kolkata)\nPost:\n${text}`;
}

const { $schema: _ignored, ...responseJsonSchema } = z.toJSONSchema(groupPostSchema) as Record<string, unknown>;

const fewShotContents = EXAMPLES.flatMap((ex) => [
  { role: 'user', parts: [{ text: formatPost(ex.posted, ex.text) }] },
  { role: 'model', parts: [{ text: JSON.stringify(ex.output) }] },
]);

/** Keep valid items only; drop items with impossible dates so one bad item never loses the whole post */
export function sanitizeParsedPost(raw: unknown, postedAt: Date): ParsedGroupPost {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const kind = z.enum(['supply', 'demand', 'noise']).safeParse(obj.kind);

  const listings: ParsedListing[] = [];
  for (const item of Array.isArray(obj.listings) ? obj.listings : []) {
    const parsed = listingSchema.safeParse(item);
    if (parsed.success && isPlausibleDate(parsed.data.date, postedAt)) listings.push(parsed.data);
  }

  const requests: ParsedRequest[] = [];
  for (const item of Array.isArray(obj.requests) ? obj.requests : []) {
    const parsed = requestSchema.safeParse(item);
    if (!parsed.success) continue;
    if (parsed.data.date && !isPlausibleDate(parsed.data.date, postedAt, 365)) delete parsed.data.date;
    requests.push(parsed.data);
  }

  return { kind: kind.success ? kind.data : 'noise', listings, requests };
}

/** Ask Gemini to turn one group post into listings / requests */
export async function parseGroupPost(text: string, postedAt: Date): Promise<ParsedGroupPost> {
  const ai = getGeminiClient();
  if (!ai) throw new Error('GEMINI_API_KEY is not set');

  const request = () =>
    ai.models.generateContent({
      model: process.env.MARKET_GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: [...fewShotContents, { role: 'user', parts: [{ text: formatPost(formatIst(postedAt), text) }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema,
      },
    });

  // Retry rate limits / overloads (429, 503) with backoff: 5s, 15s, 45s
  let response: Awaited<ReturnType<typeof request>> | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await request();
      break;
    } catch (err: any) {
      const status = err?.status ?? err?.code;
      if (attempt >= 3 || (status !== 429 && status !== 503)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5000 * 3 ** attempt));
    }
  }

  const out = response.text;
  if (!out) throw new Error('Gemini returned an empty response');
  return sanitizeParsedPost(JSON.parse(out), postedAt);
}
