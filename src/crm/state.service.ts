import { eq } from 'drizzle-orm';
import { conversationState, type ConversationStateRecord } from '../db/schema.js';

export interface ExtractedRequirements {
  guestCount?: number;
  bedroomsRequired?: number;
  boatType?: string;
  budget?: string;
  travelDate?: string;
  hasUpdates: boolean;
}

export class StateService {
  /**
   * Ensure conversation_state record exists for a conversation
   */
  public static async getOrCreateState(
    tx: any,
    conversationId: string
  ): Promise<ConversationStateRecord> {
    const existing = await tx
      .select()
      .from(conversationState)
      .where(eq(conversationState.conversationId, conversationId))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      return existing[0];
    }

    const created = await tx
      .insert(conversationState)
      .values({
        conversationId,
        updatedAt: new Date(),
      })
      .returning();

    return created[0]!;
  }

  /**
   * Deterministically extract requirements from message text (NO AI)
   */
  public static extractRequirementsFromText(text?: string | null): ExtractedRequirements {
    if (!text) {
      return { hasUpdates: false };
    }

    const lower = text.toLowerCase();
    let guestCount: number | undefined;
    let bedroomsRequired: number | undefined;
    let boatType: string | undefined;
    let budget: string | undefined;
    let travelDate: string | undefined;
    let hasUpdates = false;

    // 1. Guest Count Extraction (e.g., "6 guests", "6 people", "for 6 pax", "6 persons")
    const guestMatch = lower.match(/(\d+)\s*(guests?|people|pax|persons?|adults?)/i);
    if (guestMatch && guestMatch[1]) {
      const parsed = parseInt(guestMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0 && parsed < 200) {
        guestCount = parsed;
        hasUpdates = true;
      }
    }

    // 2. Bedrooms Required Extraction (e.g., "2 bedroom", "2 bed", "2 bhk", "3 bedrooms")
    const bedMatch = lower.match(/(\d+)\s*(bedrooms?|beds?|bhk)/i);
    if (bedMatch && bedMatch[1]) {
      const parsed = parseInt(bedMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0 && parsed < 50) {
        bedroomsRequired = parsed;
        hasUpdates = true;
      }
    }

    // 3. Boat Type Extraction
    if (lower.includes('luxury')) {
      boatType = 'luxury';
      hasUpdates = true;
    } else if (lower.includes('premium')) {
      boatType = 'premium';
      hasUpdates = true;
    } else if (lower.includes('deluxe')) {
      boatType = 'deluxe';
      hasUpdates = true;
    } else if (lower.includes('shikara')) {
      boatType = 'shikara';
      hasUpdates = true;
    }

    // 4. Budget Extraction (e.g., "budget 15000", "rs 15000", "₹15000", "15k budget")
    const budgetMatch = lower.match(/(?:budget|rs\.?|₹)\s*(\d+k?|\d{4,6})/i) ||
                         lower.match(/(\d+k?|\d{4,6})\s*budget/i);
    if (budgetMatch && budgetMatch[1]) {
      let valStr = budgetMatch[1];
      if (valStr.endsWith('k')) {
        const num = parseFloat(valStr.replace('k', '')) * 1000;
        budget = num.toString();
      } else {
        budget = valStr;
      }
      hasUpdates = true;
    }

    // 5. Travel Date Extraction (e.g., DD/MM/YYYY or DD-MM)
    // Matches 12/10, 12-10, 12/10/2026, 12.10.26
    const dateMatch = text.match(/\b(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?\b/);
    if (dateMatch && dateMatch[1] && dateMatch[2]) {
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      let year = dateMatch[3];
      if (!year) {
        year = new Date().getFullYear().toString();
      } else if (year.length === 2) {
        year = `20${year}`;
      }
      travelDate = `${year}-${month}-${day}`;
      hasUpdates = true;
    }

    return {
      guestCount,
      bedroomsRequired,
      boatType,
      budget,
      travelDate,
      hasUpdates,
    };
  }

  /**
   * Apply deterministic extraction to update conversation state if requirements found
   */
  public static async updateStateDeterministic(
    tx: any,
    conversationId: string,
    text?: string | null
  ): Promise<{ updated: boolean; state: ConversationStateRecord; extracted: ExtractedRequirements }> {
    // Ensure record exists
    await this.getOrCreateState(tx, conversationId);

    const extracted = this.extractRequirementsFromText(text);

    if (!extracted.hasUpdates) {
      const currentState = await this.getOrCreateState(tx, conversationId);
      return { updated: false, state: currentState, extracted };
    }

    const updatePayload: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (extracted.guestCount !== undefined) {
      updatePayload.guestCount = extracted.guestCount;
    }
    if (extracted.bedroomsRequired !== undefined) {
      updatePayload.bedroomsRequired = extracted.bedroomsRequired;
    }
    if (extracted.boatType !== undefined) {
      updatePayload.boatType = extracted.boatType;
    }
    if (extracted.budget !== undefined) {
      updatePayload.budget = extracted.budget;
    }
    if (extracted.travelDate !== undefined) {
      updatePayload.travelDate = extracted.travelDate;
    }

    const updated = await tx
      .update(conversationState)
      .set(updatePayload)
      .where(eq(conversationState.conversationId, conversationId))
      .returning();

    return { updated: true, state: updated[0]!, extracted };
  }
}
