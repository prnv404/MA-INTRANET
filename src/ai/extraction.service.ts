import { db } from '../db/index.js';
import type { Customer, Lead } from '../db/schema.js';
import { LeadService } from '../crm/lead.service.js';
import { extractTripDetails, isAiConfigured } from './extractor.js';
import { formatTranscript, mergeLeadDetails, parseDbTimestamp, type TranscriptMessage } from './lead-details.js';

const DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS) || 45_000;
const MAX_MESSAGES = 30;
const TIME_ZONE = process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata';
// Include messages slightly older than the lead, since the lead row is created just after the first message
const LEAD_START_MARGIN_MS = 60 * 60 * 1000;

/**
 * AI layer: reads a lead's WhatsApp conversation with Gemini and fills in trip
 * details. Once all required details are captured, the lead's ai_status becomes
 * 'completed' and the AI never touches that lead again.
 */
export class ExtractionService {
  private static timers = new Map<string, ReturnType<typeof setTimeout>>();
  private static running = new Set<string>();
  private static warnedMissingKey = false;

  /**
   * Schedule an extraction run for a lead. Repeated calls within the debounce
   * window (a customer sending several messages in a row) collapse into one run.
   */
  public static schedule(lead: Lead): void {
    if (lead.ai_status !== 'active') return;
    if (!isAiConfigured()) {
      if (!this.warnedMissingKey) {
        console.warn('⚠️ [AI] GEMINI_API_KEY is not set — AI extraction layer is disabled.');
        this.warnedMissingKey = true;
      }
      return;
    }

    const leadId = lead.lead_id;
    clearTimeout(this.timers.get(leadId));
    this.timers.set(
      leadId,
      setTimeout(() => {
        this.timers.delete(leadId);
        void this.run(leadId);
      }, DEBOUNCE_MS)
    );
  }

  /** Cancel all pending runs (used on shutdown) */
  public static cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /**
   * Run extraction for one lead now. Errors are logged, never thrown, so a
   * failing AI call can't affect message ingestion.
   */
  public static async run(leadId: string): Promise<void> {
    // A run is already in flight for this lead; try again after the debounce window
    if (this.running.has(leadId)) {
      const lead = await LeadService.findById(db, leadId).catch(() => null);
      if (lead) this.schedule(lead);
      return;
    }

    this.running.add(leadId);
    try {
      await this.extractForLead(leadId);
    } catch (err: any) {
      console.error(`❌ [AI] Extraction failed for lead ${leadId}:`, err?.message || err);
    } finally {
      this.running.delete(leadId);
    }
  }

  private static async extractForLead(leadId: string): Promise<void> {
    // Re-read the lead: the dashboard may have paused/completed it, or closed the deal, since scheduling
    const lead = await LeadService.findById(db, leadId);
    if (!lead || lead.ai_status !== 'active') return;
    if (lead.status === 'booked' || lead.status === 'lost' || lead.status === 'junk') return;

    const { data: customer, error: customerError } = await db
      .from('customers')
      .select()
      .eq('customer_id', lead.customer_id)
      .single<Customer>();
    if (customerError) throw customerError;
    if (!customer.crm_enabled || customer.contact_type !== 'customer') return;

    const messages = await this.loadConversation(lead);
    if (!messages.some((m) => m.direction === 'inbound')) return;

    const transcript = formatTranscript(messages, TIME_ZONE);
    const extracted = await extractTripDetails(transcript);
    const { updates, merged, complete } = mergeLeadDetails(lead, extracted);

    const now = new Date().toISOString();
    const { error: leadError } = await db
      .from('leads')
      .update({
        ...updates,
        ai_status: complete ? 'completed' : 'active',
        ai_last_run_at: now,
        ai_extracted: extracted,
        updated_at: now,
      })
      .eq('lead_id', lead.lead_id)
      .eq('ai_status', 'active'); // don't overwrite if the dashboard paused it mid-run
    if (leadError) throw leadError;

    await this.fillCustomerDetails(customer, extracted.customer_name, extracted.city);

    const summary = Object.entries(merged)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log(`🤖 [AI] Lead ${lead.lead_id} (${customer.whatsapp_number}): ${summary || 'no details yet'}`);
    if (complete) {
      console.log(`   └─ ✅ All required details captured — AI switched off for this lead.`);
    }
  }

  /** Last N text messages of this lead's conversation, oldest first */
  private static async loadConversation(lead: Lead): Promise<TranscriptMessage[]> {
    let query = db
      .from('messages')
      .select('direction, message_text, message_timestamp')
      .eq('customer_id', lead.customer_id)
      .not('message_text', 'is', null)
      .order('message_timestamp', { ascending: false })
      .limit(MAX_MESSAGES);

    // Only this lead's messages, so a returning customer's previous trip doesn't leak in
    if (lead.created_at) {
      const since = new Date(parseDbTimestamp(lead.created_at).getTime() - LEAD_START_MARGIN_MS);
      query = query.gte('message_timestamp', since.toISOString());
    }

    const { data, error } = await query.returns<TranscriptMessage[]>();
    if (error) throw error;
    return data.reverse();
  }

  /** Fill customer name/city from the chat, only where they're currently empty */
  private static async fillCustomerDetails(customer: Customer, name?: string, city?: string): Promise<void> {
    const updates: Partial<Customer> = {};
    if (name && !customer.name?.trim()) updates.name = name.trim();
    if (city && !customer.city?.trim()) updates.city = city.trim();
    if (Object.keys(updates).length === 0) return;

    const { error } = await db
      .from('customers')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('customer_id', customer.customer_id);
    if (error) throw error;
  }
}
