/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GeminiService — Singleton service class that encapsulates all interactions
 * with the Google Gemini API (text streaming + TTS audio generation).
 * Only this file imports from @google/genai, keeping the API surface isolated.
 */

import { GoogleGenAI, Content, Modality } from "@google/genai";
import { ChatMessage, Attachment } from "../types/chat";
import { MODEL_NAME, BASE_SYSTEM_INSTRUCTIONS } from "../constants/chat";

// ─── WAV Encoding Helpers ─────────────────────────────────────────────────────

function encodeWav(
  pcmData: Uint8Array,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number,
): Uint8Array {
  const wavHeader = new Uint8Array(44);
  const view = new DataView(wavHeader.buffer);

  // RIFF identifier
  view.setUint8(0, 82); view.setUint8(1, 73); view.setUint8(2, 70); view.setUint8(3, 70);
  view.setUint32(4, 36 + pcmData.byteLength, true);
  // WAVE identifier
  view.setUint8(8, 87); view.setUint8(9, 65); view.setUint8(10, 86); view.setUint8(11, 69);
  // fmt chunk
  view.setUint8(12, 102); view.setUint8(13, 109); view.setUint8(14, 116); view.setUint8(15, 32);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  // data chunk
  view.setUint8(36, 100); view.setUint8(37, 97); view.setUint8(38, 116); view.setUint8(39, 97);
  view.setUint32(40, pcmData.byteLength, true);

  const wavData = new Uint8Array(44 + pcmData.byteLength);
  wavData.set(wavHeader, 0);
  wavData.set(pcmData, 44);
  return wavData;
}

function base64ToWavDataUrl(base64Pcm: string): string {
  const binaryString = atob(base64Pcm);
  const pcmBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmBytes[i] = binaryString.charCodeAt(i);
  }
  const wavBytes = encodeWav(pcmBytes, 24000, 1, 16);
  let binaryWavString = "";
  for (let i = 0; i < wavBytes.byteLength; i++) {
    binaryWavString += String.fromCharCode(wavBytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binaryWavString)}`;
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
    const finalSystemInstruction = systemInstruction
      ? `${BASE_SYSTEM_INSTRUCTIONS}\n\nUSER'S PERMANENT CORE MEMORY:\n${systemInstruction}`
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
    try {
      const response = await this.client.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        return base64ToWavDataUrl(base64Audio);
      }
    } catch (error) {
      console.error("GeminiService.generateSpeech error:", error);
    }
    return null;
  }
}

// Export the singleton instance for use across the application
export const geminiService = GeminiService.getInstance();
