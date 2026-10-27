/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GeminiService — Singleton service class that encapsulates all interactions
 * with the Google Gemini API (text streaming + TTS audio generation).
 * Only this file imports from @google/genai, keeping the API surface isolated.
 */

import { GoogleGenAI, Content } from "@google/genai";
import { ChatMessage, Attachment } from "../types/chat";
import { MODEL_NAME, BASE_SYSTEM_INSTRUCTIONS } from "../constants/chat";

const FALLBACK_MODEL_NAME = "gemini-3.6-flash";

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
   * Sends the conversation history and a new user message to the Gemini API.
   * It retries transient 503 errors twice on the configured model, then tries
   * Gemini 3.6 Flash once. If output has already started, it does not restart
   * the response to avoid duplicating partial text.
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

    const modelsToTry = [MODEL_NAME, MODEL_NAME, FALLBACK_MODEL_NAME];
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
        return;
      } catch (error) {
        lastError = error;

        // Do not retry auth, key, invalid-request, or other non-capacity errors.
        if (hasYieldedText || !isTemporaryServiceError(error) || attempt === modelsToTry.length - 1) {
          throw error;
        }

        const nextModel = modelsToTry[attempt + 1];
        console.warn(
          `Gemini model ${model} returned a temporary 503. Retrying/falling back to ${nextModel}.`
        );
        await wait(attempt === 0 ? 1200 : 2200);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Gemini request failed after retries.");
  }

  /**
   * Converts a text string to speech audio via Gemini TTS and returns
   * a WAV data URL suitable for use with the HTMLAudioElement.
   */
  public async generateSpeech(
    text: string,
    voiceName: string = "Puck",
  ): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !text.trim()) return null;

    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash-lite-tts",
          input: [{
            type: "user_input",
            content: [{
              type: "text",
              text,
              annotations: [{
                type: "speech_metadata",
                style: "Speak clearly and naturally, at a comfortable pace.",
              }],
            }],
          }],
          response_format: { type: "audio" },
          generation_config: {
            speech_config: [{ voice: voiceName }],
          },
        }),
      });

      const payload: unknown = await response.json();
      const result = payload && typeof payload === "object"
        ? payload as {
            output_audio?: { data?: string };
            error?: { message?: string };
            steps?: Array<{ content?: Array<{ type?: string; data?: string }> }>;
          }
        : {};

      if (!response.ok) {
        throw new Error(result.error?.message || `Gemini TTS request failed (${response.status}).`);
      }

      const audioPart = result.steps
        ?.flatMap((step) => step.content || [])
        .filter((part) => part.type === "audio" && typeof part.data === "string")
        .at(-1);
      const base64Wav = result.output_audio?.data || audioPart?.data;
      return base64Wav ? `data:audio/wav;base64,${base64Wav}` : null;
    } catch (error) {
      console.error("GeminiService.generateSpeech error:", error);
      return null;
    }
  }
}

// Export the singleton instance for use across the application
export const geminiService = GeminiService.getInstance();
