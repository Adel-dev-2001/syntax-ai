/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GeminiService — Singleton service class that encapsulates all interactions
 * with the Google Gemini API (text streaming + TTS audio generation).
 * Only this file imports from @google/genai, keeping the API surface isolated.
 *
 * ✅ IMPROVEMENTS:
 *  - Dynamic model resolution: auto-detects the latest available Gemini Flash model
 *  - Caches the resolved model for 1 hour to avoid repeated API calls
 *  - Fallback chain if dynamic resolution fails
 *  - Fixed TTS endpoint and request format
 */

import { GoogleGenAI, Content } from "@google/genai";
import { ChatMessage, Attachment } from "../types/chat";
import { MODEL_NAME, BASE_SYSTEM_INSTRUCTIONS } from "../constants/chat";

// ─── Static fallback chain (used if dynamic resolution fails) ─────────────────
// Ordered from newest to oldest — will be tried in sequence
const STATIC_FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash-exp",
];

// Cache for the dynamically resolved model name
let resolvedModelCache: string | null = null;
let resolvedModelCacheTime = 0;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true only for temporary service-capacity errors worth retrying. */
function isTemporaryServiceError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    const message = String(error ?? "");
    return /\b503\b|UNAVAILABLE|high demand|temporarily unavailable|overloaded/i.test(message);
  }

  const apiError = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const message = String(apiError.message ?? error);
  const status = String(apiError.status ?? "");
  const code = String(apiError.code ?? "");

  return (
    status === "503" ||
    code === "503" ||
    /"code"\s*:\s*503|\b503\b|UNAVAILABLE|high demand|temporarily unavailable|overloaded/i.test(message)
  );
}

// ─── GeminiService Singleton ──────────────────────────────────────────────────

class GeminiService {
  private static instance: GeminiService;
  private _client: GoogleGenAI | null = null;

  private constructor() {}

  private get client(): GoogleGenAI {
    if (!this._client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "GEMINI_API_KEY is not defined. Add it to your .env or .env.local file and restart the Vite development server."
        );
      }
      this._client = new GoogleGenAI({ apiKey });
    }
    return this._client;
  }

  /** Returns the single shared instance (creates it on first call). */
  public static getInstance(): GeminiService {
    if (!GeminiService.instance) {
      GeminiService.instance = new GeminiService();
    }
    return GeminiService.instance;
  }

  /**
   * Dynamically resolves the best available Gemini Flash model from the API.
   * Caches the result for MODEL_CACHE_TTL_MS to avoid repeated calls.
   * Falls back to MODEL_NAME from constants if the API call fails.
   */
  private async resolveLatestModel(): Promise<string> {
    const now = Date.now();

    // Return cached result if still fresh
    if (resolvedModelCache && now - resolvedModelCacheTime < MODEL_CACHE_TTL_MS) {
      return resolvedModelCache;
    }

    try {
      const modelsPage = await this.client.models.list();
      const availableModels: string[] = [];

      for await (const model of modelsPage) {
        const name: string = (model as any).name ?? "";
        // Only consider flash models that support generateContent
        if (
          name.includes("gemini") &&
          name.includes("flash") &&
          !name.includes("tts") &&
          !name.includes("image") &&
          !name.includes("thinking")
        ) {
          // Extract just the model ID (e.g., "models/gemini-3.8-flash" → "gemini-3.8-flash")
          availableModels.push(name.replace(/^models\//, ""));
        }
      }

      if (availableModels.length > 0) {
        // Sort descending so the highest version comes first
        // e.g., gemini-3.8 > gemini-2.5 > gemini-2.0
        availableModels.sort((a, b) => {
          const versionA = parseFloat(a.match(/gemini-(\d+\.\d+)/)?.[1] ?? "0");
          const versionB = parseFloat(b.match(/gemini-(\d+\.\d+)/)?.[1] ?? "0");
          if (versionB !== versionA) return versionB - versionA;
          // Prefer non-preview/non-exp models
          const isStableA = !a.includes("preview") && !a.includes("exp") ? 1 : 0;
          const isStableB = !b.includes("preview") && !b.includes("exp") ? 1 : 0;
          return isStableB - isStableA;
        });

        const best = availableModels[0];
        console.info(`[GeminiService] Auto-resolved latest model: ${best}`);
        resolvedModelCache = best;
        resolvedModelCacheTime = now;
        return best;
      }
    } catch (err) {
      console.warn("[GeminiService] Could not list models, falling back to default.", err);
    }

    // Fall back to the configured model name
    resolvedModelCache = MODEL_NAME;
    resolvedModelCacheTime = now;
    return MODEL_NAME;
  }

  /**
   * Sends the conversation history and a new user message to the Gemini API.
   * Automatically resolves the latest available model, retries on 503 errors,
   * and falls back through STATIC_FALLBACK_MODELS if needed.
   */
  public async *sendMessageStream(
    history: ChatMessage[],
    newMessage: string,
    newAttachments: Attachment[] = [],
    systemInstruction?: string,
  ): AsyncGenerator<string> {
    const contents: Content[] = history.map((msg) => {
      const parts: any[] = [{ text: msg.text || "Attached files:" }];
      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach((att) => {
          parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
        });
      }
      return { role: msg.role === "user" ? "user" : "model", parts };
    });

    const userParts: any[] = [];
    if (newMessage.trim() || newAttachments.length === 0) {
      userParts.push({ text: newMessage || "Please process the attached files." });
    }
    newAttachments.forEach((att) => {
      userParts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
    });
    contents.push({ role: "user", parts: userParts });

    const finalSystemInstruction = systemInstruction
      ? `${BASE_SYSTEM_INSTRUCTIONS}\n\nAPP INSTRUCTIONS AND USER MEMORY:\n${systemInstruction}`
      : BASE_SYSTEM_INSTRUCTIONS;

    // Resolve the latest available model dynamically, then add static fallbacks
    const primaryModel = await this.resolveLatestModel();

    // Build attempt list: [dynamic best, gemini-3.8-flash, gemini-2.5-flash, ...]
    // Deduplicate while preserving order
    const seen = new Set<string>();
    const modelsToTry: string[] = [];
    for (const m of [primaryModel, ...STATIC_FALLBACK_MODELS]) {
      if (!seen.has(m)) {
        seen.add(m);
        modelsToTry.push(m);
      }
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
      const model = modelsToTry[attempt];
      let hasYieldedText = false;

      try {
        const responseStream = await this.client.models.generateContentStream({
          model,
          contents,
          config: { systemInstruction: finalSystemInstruction },
        });

        for await (const chunk of responseStream) {
          if (chunk.text) {
            hasYieldedText = true;
            yield chunk.text;
          }
        }

        // If this attempt succeeded with a different model, update the cache
        if (model !== primaryModel) {
          console.info(`[GeminiService] Succeeded with fallback model: ${model}`);
          resolvedModelCache = model;
          resolvedModelCacheTime = Date.now();
        }
        return;
      } catch (error) {
        lastError = error;

        const isNotFound = String((error as any)?.message ?? error).includes("404") ||
          String((error as any)?.code ?? "").includes("404");

        // If model not found, invalidate the cache and try next
        if (isNotFound) {
          console.warn(`[GeminiService] Model ${model} returned 404, trying next model.`);
          resolvedModelCache = null;
          resolvedModelCacheTime = 0;
          continue;
        }

        // Do not retry auth, key, invalid-request, or other non-capacity errors
        if (hasYieldedText || !isTemporaryServiceError(error) || attempt === modelsToTry.length - 1) {
          throw error;
        }

        const nextModel = modelsToTry[attempt + 1];
        console.warn(
          `[GeminiService] Model ${model} returned a temporary 503. Retrying/falling back to ${nextModel}.`
        );
        await wait(attempt === 0 ? 1200 : 2200);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Gemini request failed after retries.");
  }

  /**
   * Converts a text string to speech audio via Gemini TTS and returns
   * a data URL suitable for use with the HTMLAudioElement.
   *
   * ✅ FIXED: Uses correct TTS model and proper API request format.
   */
  public async generateSpeech(
    text: string,
    voiceName: string = "Puck",
  ): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !text.trim()) return null;

    // TTS model to use — gemini-2.5-flash-preview-tts is the current TTS model
    const ttsModel = "gemini-2.5-flash-preview-tts";

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${ttsModel}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text }],
              },
            ],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName,
                  },
                },
              },
            },
          }),
        }
      );

      const payload: unknown = await response.json();
      const result = payload && typeof payload === "object"
        ? payload as {
            candidates?: Array<{
              content?: {
                parts?: Array<{
                  inlineData?: { mimeType?: string; data?: string };
                }>;
              };
            }>;
            error?: { message?: string };
          }
        : {};

      if (!response.ok) {
        throw new Error(result.error?.message || `Gemini TTS request failed (${response.status}).`);
      }

      // Extract base64 audio data from the response
      const audioPart = result.candidates
        ?.flatMap((c) => c.content?.parts || [])
        .find((p) => p.inlineData?.data);

      const base64Audio = audioPart?.inlineData?.data;
      const mimeType = audioPart?.inlineData?.mimeType || "audio/wav";

      return base64Audio ? `data:${mimeType};base64,${base64Audio}` : null;
    } catch (error) {
      console.error("[GeminiService] generateSpeech error:", error);
      return null;
    }
  }
}

// Export the singleton instance for use across the application
export const geminiService = GeminiService.getInstance();
