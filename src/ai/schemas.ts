import { z } from 'zod';

export const AIOutputSchema = z.object({
  intent: z.string().nullish().describe('The core intent of the customer.'),
  lead_status: z.enum([
    'new',
    'interested',
    'inactive',
    'junk',
    'lost',
    'booked',
  ]).nullish(),
  lead_stage: z.enum([
    'new',
    'enquiry',
    'qualified',
    'recommendation',
    'quotation',
    'negotiation',
    'payment',
    'booked',
    'lost',
  ]).nullish(),
  lead_score: z.number().int().min(0).max(100).nullish().describe('0-100 score indicating buying intent.'),
  state_updates: z.object({
    travel_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').nullish(),
    guest_count: z.number().int().nullish(),
    bedrooms_required: z.number().int().nullish(),
    boat_type: z.string().nullish(),
    budget: z.number().nullish(),
    main_objection: z.string().nullish(),
  }).nullish().describe('Only return changes. Null means "no update" or "unknown", NOT "delete".'),
  events: z.array(
    z.object({
      type: z.string().nullish(),
      data: z.record(z.string(), z.any()).nullish(),
    })
  ).nullish().describe('Meaningful events extracted from the new messages, e.g. customer_objected, negotiation_started.'),
  summary: z.string().nullish().describe('A compact 100-250 word summary of the conversation so far.'),
  confidence: z.number().min(0).max(1).nullish().describe('Confidence score from 0.0 to 1.0'),
});

export type AIOutput = z.infer<typeof AIOutputSchema>;
