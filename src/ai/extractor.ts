import { getGeminiClient } from './gemini.js';
import { z } from 'zod';

/**
 * Fields Gemini extracts from a lead's WhatsApp conversation.
 * Every field is optional: Gemini omits anything the chat doesn't state.
 */
export const tripDetailsSchema = z.object({
  travel_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Check-in / cruise start date as YYYY-MM-DD. Only when a specific day can be determined.'),
  travel_date_text: z
    .string()
    .optional()
    .describe('The travel date exactly as the customer phrased it, e.g. "next Saturday", "20-22 Dec", "sometime in January".'),
  guests: z.number().int().min(1).max(200).optional().describe('Total number of people travelling (adults + children).'),
  bedrooms: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Number of bedrooms requested, e.g. "4 bed boat" or "4 bedroom" -> 4. Do not infer from guest count.'),
  cruise_type: z
    .enum(['day_cruise', 'overnight', 'multi_night'])
    .optional()
    .describe(
      'day_cruise = daytime trip only, no night stay. overnight = one night stay on the boat. multi_night = two or more nights.'
    ),
  boat_category: z
    .enum(['deluxe', 'premium', 'luxury'])
    .optional()
    .describe('Boat category, only if the customer asks for one.'),
  customer_name: z.string().optional().describe("The customer's own name, only if they state it."),
  city: z.string().optional().describe('The city the customer is travelling from, only if they state it.'),
});

export type TripDetails = z.infer<typeof tripDetailsSchema>;

const SYSTEM_INSTRUCTION = `You extract booking details from WhatsApp chats between a houseboat cruise company's sales rep and a customer.

Rules:
- Extract only what the customer states or clearly confirms. Never guess or fill in typical values.
- If a detail changes during the chat, return the latest value.
- Resolve relative dates ("tomorrow", "this Saturday", "next week Friday") using the timestamp of the message they appear in.
- If the chat only gives a vague date ("January", "after Onam"), set travel_date_text and omit travel_date.
- The chat may mix English with Malayalam, Hindi or other languages, and use abbreviations ("4 bdrm", "2 ppl", "ON" for overnight).
- Omit any field that is not in the conversation.`;

export { isAiConfigured } from './gemini.js';

// JSON schema sent to Gemini (without the $schema meta key)
const { $schema: _ignored, ...responseJsonSchema } = z.toJSONSchema(tripDetailsSchema) as Record<string, unknown>;

/**
 * Ask Gemini to extract trip details from a formatted conversation transcript.
 */
export async function extractTripDetails(transcript: string): Promise<TripDetails> {
  const ai = getGeminiClient();
  if (!ai) throw new Error('GEMINI_API_KEY is not set');

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    contents: transcript,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0,
      responseMimeType: 'application/json',
      responseJsonSchema,
    },
  });

  const text = response.text;
  if (!text) throw new Error('Gemini returned an empty response');

  // Validate field-by-field so one bad value (e.g. guests: 0) only drops that field
  const raw = JSON.parse(text) as Record<string, unknown>;
  const details: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(tripDetailsSchema.shape)) {
    const parsed = field.safeParse(raw?.[key]);
    if (parsed.success && parsed.data !== undefined) details[key] = parsed.data;
  }
  return details as TripDetails;
}
