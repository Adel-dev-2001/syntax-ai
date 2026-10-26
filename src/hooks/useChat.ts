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
    () => localStorage.getItem(MEMORY_KEY) || "",
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
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed: ChatSession[] = JSON.parse(saved);
      setSessions(parsed);
      if (parsed.length > 0) {
        setSessionId(parsed[0].id);
        setMessages(parsed[0].messages);
        setCurrentLeafId(parsed[0].currentLeafId);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextList));
      return nextList;
    });
  }, [messages, sessionId, currentLeafId]);

  // ── Sync core memory updated from other tabs ──────────────────────────────
  useEffect(() => {
    const handleMemoryUpdate = () =>
      setCoreMemory(localStorage.getItem(MEMORY_KEY) || "");
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextList));
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
    URL.revokeObjectURL(url);
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

      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
          alert(`File ${file.name} is too large. Max size is 5MB.`);
          continue;
        }
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = (ev) =>
            resolve((ev.target?.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        try {
          const base64Data = await base64Promise;
          newAttachments.push({
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            data: base64Data,
          });
        } catch (err) {
          console.error("useChat: failed to read file", err);
        }
      }

      setAttachments((prev) => [...prev, ...newAttachments]);
      // Reset the file input value so the same file can be re-selected
      e.target.value = "";
    },
    [],
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

        // Finalise message: extract & persist memory tags, mark streaming done
        if (generationIdRef.current === currentGenId) {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantMsgId) return msg;

              const memoryRegex = /<memory>([\s\S]*?)<\/memory>/g;
              let cleanText = accumulatedText;
              let match: RegExpExecArray | null;
              const newMemories: string[] = [];

              while ((match = memoryRegex.exec(accumulatedText)) !== null) {
                newMemories.push(match[1].trim());
                cleanText = cleanText.replace(match[0], "");
              }

              if (newMemories.length > 0) {
                const existing = localStorage.getItem(MEMORY_KEY) || "";
                const updated = existing
                  ? `${existing}\n- ${newMemories.join("\n- ")}`
                  : `- ${newMemories.join("\n- ")}`;
                localStorage.setItem(MEMORY_KEY, updated);
                setCoreMemory(updated);
                window.dispatchEvent(new Event("memoryUpdated"));
              }

              return { ...msg, text: cleanText.trim(), isStreaming: false };
            }),
          );
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
