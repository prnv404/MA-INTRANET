import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIOutputSchema, type AIOutput } from './schemas.js';
import { SYSTEM_PROMPT } from './prompts.js';

export async function analyzeWithGemini(contextStr: string): Promise<{ data: AIOutput | null; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash'; // defaulting to a fast model
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1, // low temperature for more deterministic output
    },
  });

  try {
    const result = await model.generateContent(contextStr);
    const text = result.response.text();
    
    // Parse JSON
    const rawJson = JSON.parse(text);
    
    // Validate with Zod
    const validated = AIOutputSchema.parse(rawJson);
    
    return { data: validated, model: modelName };
  } catch (error) {
    console.error('❌ [GEMINI] Failed to analyze conversation:', error);
    return { data: null, model: modelName };
  }
}
