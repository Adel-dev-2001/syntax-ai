/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useChat — Master custom hook managing the full chat lifecycle:
 *   - Session persistence (localStorage)
 *   - Message streaming via GeminiService
 *   - Branching conversation tree navigation
 *   - Core memory extraction and persistence
 *   - File attachment handling
 *   - Stop-generation control
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ChatMessage, ChatSession, Attachment } from "../types/chat";
import { DEFAULT_SYSTEM_PROMPT } from "../constants/chat";
import { geminiService } from "../services/GeminiService";
import {
  getActiveThread,
  getSiblings,
  getLeafOfNode,
} from "../lib/tree";

const STORAGE_KEY = "syntax_chat_sessions";
const MEMORY_KEY = "syntax_core_memory";
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const TEXT_FILE_EXTENSIONS = /\.(txt|md|csv|json|xml|html?|css|js|jsx|ts|tsx|py|java|c|cpp|h|hpp|sql|yaml|yml|toml|log)$/i;

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`Syntax AI could not read local storage key "${key}".`, error);
    return null;
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Syntax AI could not save local storage key "${key}". Browser storage may be full or disabled.`, error);
    return false;
  }
}

// Large Base64 attachments can exceed the browser's small localStorage quota.
// Keep chat text in history, but require users to reattach files after a page reload.
function toPersistableSessions(sessions: ChatSession[]): ChatSession[] {
  return sessions.map((session) => ({
    ...session,
    messages: session.messages.map(({ attachments: _attachments, ...message }) => message),
  }));
}

// ─── Hook Interface ───────────────────────────────────────────────────────────

interface UseChatOptions {
  input: string;
  setInput: (value: string) => void;
}

export interface UseChatReturn {
  // State
  messages: ChatMessage[];
  sessions: ChatSession[];
  sessionId: string;
  currentLeafId: string | undefined;
  activeMessages: ChatMessage[];
  isLoading: boolean;
  attachments: Attachment[];
  coreMemory: string;
  sessionToDelete: string | null;

  // Actions
  handleSend: (overrideInput?: string, editedMessageId?: string) => Promise<void>;
  handleStop: () => void;
  handleClearChat: () => void;
  handleExport: () => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  removeAttachment: (index: number) => void;
  selectSession: (id: string, msgs: ChatMessage[], leafId?: string) => void;
  confirmDeleteSession: (e: React.MouseEvent, id: string) => void;
  deleteSession: (id: string) => void;
  setCurrentLeafId: (id: string | undefined) => void;
  setCoreMemory: (memory: string) => void;
  setSessionToDelete: (id: string | null) => void;
  getSiblings: (allMessages: ChatMessage[], messageId: string) => ChatMessage[];
  getLeafOfNode: (allMessages: ChatMessage[], nodeId: string) => string;
}

// ─── Hook Implementation ──────────────────────────────────────────────────────

export function useChat({ input, setInput }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>(() =>
    Date.now().toString(),
  );
  const [currentLeafId, setCurrentLeafId] = useState<string | undefined>();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [coreMemory, setCoreMemory] = useState<string>(
    () => safeGetItem(MEMORY_KEY) || "",
  );
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  const stopRef = useRef<boolean>(false);
  const generationIdRef = useRef<number>(0);

  // Active linear thread from the branching message tree
  const activeMessages = useMemo(
    () => getActiveThread(messages, currentLeafId),
    [messages, currentLeafId],
  );

  // ── Load sessions from localStorage on mount ──────────────────────────────
  useEffect(() => {
    const saved = safeGetItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed: unknown = JSON.parse(saved);
      const isValidSessionList = Array.isArray(parsed) && parsed.every((session) =>
        session &&
        typeof session.id === "string" &&
        typeof session.title === "string" &&
        Array.isArray(session.messages) &&
        session.messages.every((message: unknown) => {
          if (!message || typeof message !== "object") return false;
          const candidate = message as Record<string, unknown>;
          return typeof candidate.id === "string" &&
            (candidate.role === "user" || candidate.role === "model") &&
            typeof candidate.text === "string";
        })
      );
      if (!isValidSessionList) {
        console.warn("Syntax AI ignored invalid saved chat data.");
        return;
      }
      const validSessions = parsed as ChatSession[];
      setSessions(validSessions);
      if (validSessions.length > 0) {
        setSessionId(validSessions[0].id);
        setMessages(validSessions[0].messages);
        setCurrentLeafId(validSessions[0].currentLeafId);
      }
    } catch (e) {
      console.error("useChat: failed to parse saved sessions", e);
    }
  }, []);

  // ── Persist sessions whenever the active conversation changes ─────────────
  useEffect(() => {
    if (messages.length === 0 && !sessions.find((s) => s.id === sessionId))
      return;

    setSessions((prev) => {
      const existing = prev.find((s) => s.id === sessionId);
      if (messages.length === 0 && !existing) return prev;

      const title =
        existing?.title ||
        (messages[0]?.text.length > 30
          ? messages[0].text.substring(0, 30) + "..."
          : messages[0]?.text || "New chat");

      let nextList: ChatSession[];
      if (existing) {
        nextList = prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages, currentLeafId, title, updatedAt: Date.now() }
            : s,
        );
      } else {
        nextList = [
          { id: sessionId, title, messages, currentLeafId, updatedAt: Date.now() },
          ...prev,
        ];
      }

      nextList.sort((a, b) => b.updatedAt - a.updatedAt);
      safeSetItem(STORAGE_KEY, JSON.stringify(toPersistableSessions(nextList)));
      return nextList;
    });
  }, [messages, sessionId, currentLeafId]);

  // ── Sync core memory updated from other tabs ──────────────────────────────
  useEffect(() => {
    const handleMemoryUpdate = () =>
      setCoreMemory(safeGetItem(MEMORY_KEY) || "");
    window.addEventListener("memoryUpdated", handleMemoryUpdate);
    return () => window.removeEventListener("memoryUpdated", handleMemoryUpdate);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setCurrentLeafId(undefined);
    setSessionId(Date.now().toString());
    if (window.innerWidth < 768) {
      // auto-close sidebar on mobile after starting a new chat
    }
  }, []);

  const selectSession = useCallback(
    (id: string, msgs: ChatMessage[], leafId?: string) => {
      setSessionId(id);
      setMessages(msgs);
      setCurrentLeafId(leafId);
    },
    [],
  );

  const confirmDeleteSession = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setSessionToDelete(id);
    },
    [],
  );

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const nextList = prev.filter((s) => s.id !== id);
        safeSetItem(STORAGE_KEY, JSON.stringify(toPersistableSessions(nextList)));
        if (sessionId === id) {
          if (nextList.length > 0) {
            setSessionId(nextList[0].id);
            setMessages(nextList[0].messages);
            setCurrentLeafId(nextList[0].currentLeafId);
          } else {
            setSessionId(Date.now().toString());
            setMessages([]);
            setCurrentLeafId(undefined);
          }
        }
        return nextList;
      });
      setSessionToDelete(null);
    },
    [sessionId],
  );

  const handleExport = useCallback(() => {
    if (activeMessages.length === 0) return;
    const content = activeMessages
      .map((m) => `**${m.role === "user" ? "You" : "Syntax AI"}**:\n\n${m.text}`)
      .join("\n\n---\n\n");
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `syntax-chat-${new Date().toISOString().split("T")[0]}.md`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [activeMessages]);

  const handleStop = useCallback(() => {
    stopRef.current = true;
    setIsLoading(false);
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const files = Array.from(e.target.files);
      const newAttachments: Attachment[] = [];
      const warnings: string[] = [];
      let totalBytes = attachments.reduce((sum, attachment) =>
        sum + (attachment.size ?? Math.ceil(attachment.data.length * 3 / 4)), 0);

      for (const file of files) {
        if (attachments.length + newAttachments.length >= MAX_ATTACHMENT_COUNT) {
          warnings.push(`You can attach up to ${MAX_ATTACHMENT_COUNT} files per message.`);
          break;
        }
        if (file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          warnings.push(`${file.name}: each file must be larger than 0 bytes and no larger than 5 MB.`);
          continue;
        }
        if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
          warnings.push(`Attachments together cannot exceed 10 MB per message.`);
          continue;
        }

        const extension = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || "";
        const type = file.type.toLowerCase();
        const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
        const isPdf = type === "application/pdf" || extension === "pdf";
        const isImage = imageTypes.has(type);
        const isText = type.startsWith("text/") || TEXT_FILE_EXTENSIONS.test(file.name);
        if (!isPdf && !isImage && !isText) {
          warnings.push(`${file.name}: use an image, PDF, text, or source-code file.`);
          continue;
        }

        const mimeType = isPdf ? "application/pdf" : isImage ? type : "text/plain";
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            if (typeof reader.result !== "string" || !reader.result.includes(",")) {
              reject(new Error("Unexpected file reader result"));
              return;
            }
            resolve(reader.result.split(",", 2)[1]);
          };
          reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
          reader.readAsDataURL(file);
        });
        try {
          const base64Data = await base64Promise;
          newAttachments.push({
            name: file.name,
            mimeType,
            data: base64Data,
            size: file.size,
          });
          totalBytes += file.size;
        } catch (err) {
          console.error("useChat: failed to read file", err);
          warnings.push(`${file.name}: could not read this file.`);
        }
      }

      if (warnings.length > 0) alert([...new Set(warnings)].join("\n"));
      setAttachments((prev) => [...prev, ...newAttachments]);
      // Reset the file input value so the same file can be re-selected
      e.target.value = "";
    },
    [attachments],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(
    async (overrideInput?: string, editedMessageId?: string) => {
      const textToSend = overrideInput ?? input;
      const currentAttachments = [...attachments];

      if (!textToSend.trim() && currentAttachments.length === 0) return;

      // Stop any ongoing generation before starting a new one
      if (isLoading) {
        stopRef.current = true;
        setIsLoading(false);
        await new Promise((r) => setTimeout(r, 50));
      }

      let thread = activeMessages;
      let parentId =
        thread.length > 0 ? thread[thread.length - 1].id : undefined;

      if (editedMessageId) {
        const editedMsg = messages.find((m) => m.id === editedMessageId);
        if (editedMsg) {
          parentId = editedMsg.parentId;
          thread = parentId ? getActiveThread(messages, parentId) : [];
        }
      }

      const userMsgId = Date.now().toString();
      const userMessage: ChatMessage = {
        id: userMsgId,
        role: "user",
        text: textToSend,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        parentId,
      };

      setMessages((prev) => [...prev, userMessage]);
      setCurrentLeafId(userMsgId);

      if (!overrideInput) {
        setInput("");
        setAttachments([]);
      }

      setIsLoading(true);
      stopRef.current = false;
      const currentGenId = ++generationIdRef.current;

      const assistantMsgId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: "model", text: "", isStreaming: true, parentId: userMsgId },
      ]);
      setCurrentLeafId(assistantMsgId);

      try {
        const activeSystemPrompt = coreMemory
          ? `${DEFAULT_SYSTEM_PROMPT}\n\nUSER FACTS TO REMEMBER:\n${coreMemory}`
          : DEFAULT_SYSTEM_PROMPT;

        const stream = geminiService.sendMessageStream(
          thread,
          textToSend,
          currentAttachments,
          activeSystemPrompt,
        );

        let accumulatedText = "";
        for await (const chunk of stream) {
          if (stopRef.current || generationIdRef.current !== currentGenId) break;
          accumulatedText += chunk;

          // Strip memory tags from the displayed content while streaming
          let displayContent = accumulatedText.replace(
            /<memory>[\s\S]*?<\/memory>/g,
            "",
          );
          if (displayContent.includes("<memory>")) {
            displayContent = displayContent.split("<memory>")[0];
          }

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, text: displayContent.trim() }
                : msg,
            ),
          );
        }

        // Finalise the text and persist memory outside the React state updater.
        // State updater callbacks must stay pure because React may invoke them more than once.
        if (generationIdRef.current === currentGenId) {
          const memoryRegex = /<memory>([\s\S]*?)<\/memory>/g;
          const newMemories = Array.from(accumulatedText.matchAll(memoryRegex), (match) =>
            match[1].trim(),
          ).filter(Boolean);
          const cleanText = accumulatedText
            .replace(memoryRegex, "")
            .replace(/<memory>[\s\S]*$/g, "")
            .trim();

          if (newMemories.length > 0) {
            const existing = safeGetItem(MEMORY_KEY) || "";
            const updated = existing
              ? `${existing}\n- ${newMemories.join("\n- ")}`
              : `- ${newMemories.join("\n- ")}`;
            safeSetItem(MEMORY_KEY, updated);
            setCoreMemory(updated);
            window.dispatchEvent(new Event("memoryUpdated"));
          }

          setMessages((prev) => prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, text: cleanText, isStreaming: false }
              : msg,
          ));
        }
      } catch (error) {
        console.error("useChat: error generating response:", error);
        if (generationIdRef.current === currentGenId) {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantMsgId
                ? {
                    ...message,
                    text: "The response could not be completed. Check your API configuration or connection and try again.",
                    isStreaming: false,
                  }
                : message,
            ),
          );
        }
      } finally {
        if (generationIdRef.current === currentGenId) {
          setIsLoading(false);
        }
      }
    },
    [input, attachments, isLoading, activeMessages, messages, coreMemory, setInput],
  );

  return {
    messages,
    sessions,
    sessionId,
    currentLeafId,
    activeMessages,
    isLoading,
    attachments,
    coreMemory,
    sessionToDelete,
    handleSend,
    handleStop,
    handleClearChat,
    handleExport,
    handleFileChange,
    removeAttachment,
    selectSession,
    confirmDeleteSession,
    deleteSession,
    setCurrentLeafId,
    setCoreMemory,
    setSessionToDelete,
    getSiblings,
    getLeafOfNode,
  };
}
