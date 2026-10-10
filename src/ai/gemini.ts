import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | null = null;

/** Shared Gemini client, or null when GEMINI_API_KEY is not set */
export function getGeminiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}
