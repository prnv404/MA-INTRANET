import { analyzeConversationJob } from '../ai/analyze-conversation.ts';

// Configuration
const DEBOUNCE_MS = 60000; // 1 minute (60 seconds)

// In-memory state for debounce and concurrency
const timers = new Map<string, NodeJS.Timeout>();
const processingLocks = new Set<string>();

/**
 * Schedules an AI analysis for a conversation.
 * Uses a debounce window. If called multiple times within the window,
 * the timer resets, batching rapid messages together.
 */
export function scheduleConversationAnalysis(conversationId: string, triggerMessageId: string) {
  // If a timer already exists, cancel it (debounce)
  if (timers.has(conversationId)) {
    clearTimeout(timers.get(conversationId));
  }

  // Set a new timer
  const timer = setTimeout(() => {
    timers.delete(conversationId);
    void executeAnalysis(conversationId, triggerMessageId);
  }, DEBOUNCE_MS);

  timers.set(conversationId, timer);
}

/**
 * Executes the analysis, ensuring only one runs at a time per conversation.
 */
async function executeAnalysis(conversationId: string, triggerMessageId: string) {
  if (processingLocks.has(conversationId)) {
    console.log(`⏳ [AI WORKER] Conversation ${conversationId} is already being analyzed. Re-scheduling.`);
    // Re-schedule to try again later
    scheduleConversationAnalysis(conversationId, triggerMessageId);
    return;
  }

  processingLocks.add(conversationId);

  try {
    await analyzeConversationJob(conversationId, triggerMessageId);
  } catch (err) {
    console.error(`❌ [AI WORKER] Error analyzing conversation ${conversationId}:`, err);
  } finally {
    processingLocks.delete(conversationId);
  }
}
