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
   * Sends the conversation history and a new user message to the Gemini API
   * and yields response text chunks as they stream in.
   *
   * @param history - The current linear conversation thread (active branch).
   * @param newMessage - The user's latest message text.
   * @param newAttachments - Any file attachments included with the message.
   * @param systemInstruction - Optional override for the system prompt.
   */
  public async *sendMessageStream(
    history: ChatMessage[],
    newMessage: string,
    newAttachments: Attachment[] = [],
    systemInstruction?: string,
  ): AsyncGenerator<string> {
    // Convert app ChatMessage format to Gemini Content format
    const contents: Content[] = history.map((msg) => {
      const parts: any[] = [{ text: msg.text || "Attached files:" }];
      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach((att) => {
          parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
        });
      }
      return { role: msg.role === "user" ? "user" : "model", parts };
    });

    // Build the new user message parts
    const userParts: any[] = [];
    if (newMessage.trim() || newAttachments.length === 0) {
      userParts.push({ text: newMessage || "Please process the attached files." });
    }
    newAttachments.forEach((att) => {
      userParts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
    });
    contents.push({ role: "user", parts: userParts });

    // Compose the final system instruction with optional user-provided override
    // The second instruction is the app's active prompt (including user-edited memory),
    // not memory by itself. Keep the label accurate so the model gets clear instructions.
    const finalSystemInstruction = systemInstruction
      ? `${BASE_SYSTEM_INSTRUCTIONS}\n\nAPP INSTRUCTIONS AND USER MEMORY:\n${systemInstruction}`
      : BASE_SYSTEM_INSTRUCTIONS;

    const responseStream = await this.client.models.generateContentStream({
      model: MODEL_NAME,
      contents,
      config: { systemInstruction: finalSystemInstruction },
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  }

  /**
   * Converts a text string to speech audio via Gemini TTS and returns
   * a WAV data URL suitable for use with the HTMLAudioElement.
   *
   * @param text - The text to convert to speech.
   * @param voiceName - The Gemini prebuilt voice name (default: "Puck").
   * @returns A WAV data URL, or null if generation fails.
   */
  public async generateSpeech(
    text: string,
    voiceName: string = "Puck",
  ): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !text.trim()) return null;

    try {
      // Gemini 3.8 TTS returns a complete WAV file. Call the current Interactions
      // endpoint directly so we do not wrap WAV bytes in a second WAV header.
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

      // The SDK exposes output_audio as a convenience property; the raw REST
      // response stores the same base64 audio under steps[].content[].data.
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
