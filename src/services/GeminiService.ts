/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GeminiService — Singleton service class that encapsulates all interactions
 * with the Google Gemini API (text streaming + TTS audio generation).
 * Only this file imports from @google/genai, keeping the API surface isolated.
 *
 * ✅ FIXED:
 *  - Removed blocking models.list() call that was causing the app to hang
 *  - Smart fallback chain: if a model returns 404, auto-tries the next one
 *  - Fixed TTS endpoint and request format
 */

import { GoogleGenAI, Content } from "@google/genai";
import { ChatMessage, Attachment } from "../types/chat";
import { MODEL_NAME, BASE_SYSTEM_INSTRUCTIONS } from "../constants/chat";

/**
 * Ordered fallback chain — newest to oldest.
 * If the primary model returns 404, the service automatically
 * tries each fallback in order without blocking or hanging.
 */
const FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-exp",
];

// Remember the last model that worked, so we skip 404s on the next message
let lastWorkingModel: string = MODEL_NAME;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true only for temporary service-capacity errors worth retrying. */
function isTemporaryServiceError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    const message = String(error ?? "");
    return /\b503\b|UNAVAILABLE|high demand|temporarily unavailable|overloaded/i.test(message);
  }
  const apiError = error as { status?: unknown; code?: unknown; message?: unknown };
  const message = String(apiError.message ?? error);
  const status = String(apiError.status ?? "");
  const code = String(apiError.code ?? "");
  return (
    status === "503" ||
    code === "503" ||
    /"code"\s*:\s*503|\b503\b|UNAVAILABLE|high demand|temporarily unavailable|overloaded/i.test(message)
  );
}

/** Returns true if the error means the model name is invalid / deprecated. */
function isModelNotFoundError(error: unknown): boolean {
  const msg = String((error as any)?.message ?? error ?? "");
  return (
    msg.includes("404") ||
    msg.includes("NOT_FOUND") ||
    msg.includes("no longer available") ||
    msg.includes("deprecated")
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

  public static getInstance(): GeminiService {
    if (!GeminiService.instance) {
      GeminiService.instance = new GeminiService();
    }
    return GeminiService.instance;
  }

  /**
   * Sends the conversation history and a new user message to the Gemini API.
   *
   * Strategy:
   *  1. Start with the last model that worked (avoids retrying dead models)
   *  2. If it returns 404, move to the next fallback automatically
   *  3. If it returns 503, retry with a short delay
   *  4. No blocking pre-flight API calls — messages send instantly
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

    // Build attempt list starting from the last model that succeeded
    const seen = new Set<string>();
    const modelsToTry: string[] = [];
    for (const m of [lastWorkingModel, ...FALLBACK_MODELS]) {
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

        // Remember this model worked
        lastWorkingModel = model;
        return;

      } catch (error) {
        lastError = error;

        // Model is gone (404) → silently try the next one
        if (isModelNotFoundError(error)) {
          console.warn(`[GeminiService] Model "${model}" not available, trying next fallback.`);
          continue;
        }

        // Don't retry non-transient errors or if we already started streaming
        if (hasYieldedText || !isTemporaryServiceError(error) || attempt === modelsToTry.length - 1) {
          throw error;
        }

        // Transient 503 — wait then retry
        const nextModel = modelsToTry[attempt + 1];
        console.warn(`[GeminiService] Model "${model}" returned 503. Retrying with "${nextModel}".`);
        await wait(attempt === 0 ? 1200 : 2200);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Gemini request failed after all fallbacks.");
  }

  /**
   * Converts text to speech audio via Gemini TTS.
   * Returns a data URL suitable for HTMLAudioElement, or null on failure.
   */
  public async generateSpeech(
    text: string,
    voiceName: string = "Puck",
  ): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !text.trim()) return null;

    const ttsModel = "gemini-2.5-flash-preview-tts";

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${ttsModel}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
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
        throw new Error(result.error?.message || `TTS failed (${response.status}).`);
      }

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

export const geminiService = GeminiService.getInstance();
