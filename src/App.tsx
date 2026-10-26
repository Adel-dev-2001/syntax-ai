/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App.tsx — Root UI component.
 * All business logic is delegated to the custom hooks:
 *   - useTheme        → dark/light mode
 *   - useSpeechRecognition → microphone input
 *   - useChat         → messaging, sessions, memory, attachments
 */

import React, { useState, useRef, useEffect } from "react";
import {
  ArrowUp,
  ArrowDown,
  Trash2,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquarePlus,
  Square,
  Sparkles,
  Download,
  Settings,
  ChevronDown,
  Terminal,
  Mic,
  Paperclip,
  X,
  XCircle,
  FileText,
  Settings2,
  Play,
  Volume2,
} from "lucide-react";
import { Button } from "./components/ui/Button";
import { Textarea } from "./components/ui/Textarea";
import { MessageItem } from "./components/MessageItem";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useTheme } from "./hooks/useTheme";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useChat } from "./hooks/useChat";
import { SUGGESTIONS, GEMINI_VOICES } from "./constants/chat";
import { geminiService } from "./services/GeminiService";

export default function App() {
  const { isDarkMode, toggleDarkMode } = useTheme();

  const [input, setInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollButtonDirection, setScrollButtonDirection] = useState<"up" | "down">("up");

  const [speechLang, setSpeechLang] = useState<string>(
    () => localStorage.getItem("speech_lang") || "",
  );
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("Puck");
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist chosen speech language
  useEffect(() => {
    localStorage.setItem("speech_lang", speechLang);
  }, [speechLang]);

  // Chat logic
  const chat = useChat({ input, setInput });

  // Speech recognition
  const { isRecording, toggleRecording } = useSpeechRecognition({
    lang: speechLang,
    onTranscript: setInput,
  });

  // Auto-scroll to the latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 300) {
      setShowScrollButton(false);
      return;
    }

    const isFarFromTop = scrollTop > 300;
    const isFarFromBottom = maxScroll - scrollTop > 300;

    if (isFarFromTop || isFarFromBottom) {
      setShowScrollButton(true);
      if (scrollTop > maxScroll / 2) {
        setScrollButtonDirection("up");
      } else {
        setScrollButtonDirection("down");
      }
    } else {
      setShowScrollButton(false);
    }
  };

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chat.handleSend();
    }
  };

  const previewVoice = async () => {
    if (isPreviewingVoice || !selectedVoiceName) return;
    setIsPreviewingVoice(true);
    try {
      const audioUrl = await geminiService.generateSpeech(
        `Hello, my name is ${selectedVoiceName}. How can I assist you with your code today?`,
        selectedVoiceName,
      );
      if (audioUrl) {
        previewAudioRef.current?.pause();
        const newAudio = new Audio(audioUrl);
        previewAudioRef.current = newAudio;
        newAudio.onended = () => setIsPreviewingVoice(false);
        await newAudio.play();
      } else {
        setIsPreviewingVoice(false);
      }
    } catch (e) {
      console.error("previewVoice error:", e);
      setIsPreviewingVoice(false);
    }
  };

  return (
    <div className="flex h-screen bg-background text-foreground transition-colors">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex-shrink-0 bg-sidebar border-r border-border transition-all duration-300 overflow-hidden hidden md:flex flex-col",
          isSidebarOpen ? "w-72" : "w-0 border-r-0",
        )}
      >
        <div className="p-4 flex flex-col h-full">
          <div className="flex items-center gap-2 mb-4">
            <Button
              onClick={chat.handleClearChat}
              className="flex-1 justify-start gap-3 bg-background border border-border hover:bg-muted text-foreground rounded-xl font-medium py-6 shadow-sm"
            >
              <MessageSquarePlus size={18} className="text-primary" />
              <span>New Chat</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(false)}
              className="shrink-0 h-[50px] w-[50px] border border-border bg-background hover:bg-muted rounded-xl text-muted-foreground hover:text-foreground hidden md:flex items-center justify-center shadow-sm"
              title="Close Sidebar"
            >
              <PanelLeftClose size={20} />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-2 px-2 mt-2">
              Recent Chats
            </div>
            <div className="flex flex-col gap-1">
              {chat.sessions.length > 0 ? (
                chat.sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() =>
                      chat.selectSession(
                        session.id,
                        session.messages,
                        session.currentLeafId,
                      )
                    }
                    className={cn(
                      "p-3 border rounded-xl cursor-pointer group hover:bg-muted/50 transition-colors relative",
                      chat.sessionId === session.id
                        ? "bg-muted border-border"
                        : "bg-transparent border-transparent",
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-3 overflow-hidden flex-1">
                        <div
                          className={cn(
                            "shrink-0 w-2 h-2 rounded-full",
                            chat.sessionId === session.id
                              ? "bg-emerald-500"
                              : "bg-muted-foreground/30",
                          )}
                        />
                        <div className="text-sm font-medium truncate group-hover:text-foreground text-left transition-colors">
                          {session.title}
                        </div>
                      </div>
                      <button
                        onClick={(e) => chat.confirmDeleteSession(e, session.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded-full transition-all text-muted-foreground ml-2 shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1.5 text-left pl-5 opacity-70">
                      {new Date(session.updatedAt).toLocaleDateString()} •{" "}
                      {session.messages.length} messages
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-xs text-muted-foreground p-4 opacity-70">
                  No recent chats
                </div>
              )}
            </div>
          </div>

          <div className="mt-auto border-t border-border pt-4 flex flex-col gap-1">
            <Button
              onClick={toggleDarkMode}
              variant="ghost"
              className="w-full justify-start gap-3 text-sm"
            >
              {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
              {isDarkMode ? "Light Mode" : "Dark Mode"}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Settings size={16} />
              Settings
            </Button>
          </div>
        </div>
      </aside>

      {/* ── Decorative background blobs ──────────────────────────────────────── */}
      <div className="fixed bg-indigo-500 w-96 h-96 top-0 left-0 rounded-full mix-blend-multiply filter blur-[128px] opacity-20 pointer-events-none z-0" />
      <div
        className="fixed bg-purple-500 w-96 h-96 bottom-0 right-0 rounded-full mix-blend-multiply filter blur-[128px] opacity-20 pointer-events-none z-0"
        style={{ animationDelay: "-5s" }}
      />

      {/* ── Main Chat Area ────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative z-10">

        {/* Header */}
        <header className="h-16 border-b border-border flex items-center px-6 justify-between bg-background/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {/* Desktop: show open-sidebar button only when sidebar is closed */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(true)}
              className={cn(
                "text-muted-foreground hover:text-foreground hidden md:flex",
                isSidebarOpen && "md:hidden",
              )}
            >
              <PanelLeftOpen size={20} />
            </Button>
            {/* Mobile sidebar toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="text-muted-foreground hover:text-foreground md:hidden"
            >
              {isSidebarOpen ? (
                <PanelLeftClose size={20} />
              ) : (
                <PanelLeftOpen size={20} />
              )}
            </Button>
            <div className="flex items-center gap-2">
              <div className="bg-primary text-primary-foreground p-1.5 rounded-lg shadow-sm">
                <Terminal size={18} />
              </div>
              <h1 className="text-sm font-bold tracking-tight">Syntax AI</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {chat.activeMessages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={chat.handleExport}
                className="hidden sm:flex items-center gap-2 h-8 text-xs font-medium rounded-lg"
              >
                <Download size={14} />
                Export
              </Button>
            )}
            <Button
              variant="icon"
              onClick={chat.handleClearChat}
              title="New Chat"
              className="md:hidden"
            >
              <MessageSquarePlus size={18} />
            </Button>
            <Button
              variant="icon"
              onClick={toggleDarkMode}
              className="md:hidden"
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
          </div>
        </header>

        {/* Chat Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto pb-48"
        >
          {chat.activeMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 max-w-3xl mx-auto">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="w-16 h-16 bg-primary/10 border border-primary/20 rounded-2xl flex items-center justify-center mb-6 shadow-sm relative"
              >
                <Terminal size={32} className="text-primary" />
                <Sparkles
                  size={16}
                  className="absolute -top-2 -right-2 text-primary"
                />
              </motion.div>
              <motion.h2
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="text-2xl font-semibold mb-3 tracking-tight"
              >
                How can I help you build today?
              </motion.h2>
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-sm text-muted-foreground/80 max-w-lg leading-relaxed mb-8"
              >
                I'm Syntax AI, your elite coding assistant. Ask me about
                software architecture, debugging, or any clean code queries.
              </motion.p>

              <motion.div
                initial={{ y: 15, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full text-left"
              >
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => chat.handleSend(s.prompt)}
                    className="flex flex-col items-start p-4 rounded-2xl border border-border bg-input hover:bg-muted hover:border-border/80 transition-all group shadow-sm text-sm text-left"
                  >
                    <span className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
                      <Sparkles size={14} className="text-primary" />
                      {s.title}
                    </span>
                    <span className="text-muted-foreground text-xs leading-relaxed truncate w-full opacity-80 group-hover:opacity-100">
                      {s.prompt}
                    </span>
                  </button>
                ))}
              </motion.div>
            </div>
          ) : (
            <div className="flex flex-col">
              {chat.activeMessages.map((msg) => {
                const siblings = chat.getSiblings(chat.messages, msg.id);
                const siblingIndex = siblings.findIndex((s) => s.id === msg.id);
                const siblingCount = siblings.length;

                const handleNavigateSibling = (direction: "prev" | "next") => {
                  const nextIndex =
                    direction === "prev" ? siblingIndex - 1 : siblingIndex + 1;
                  if (nextIndex >= 0 && nextIndex < siblingCount) {
                    const newLeaf = chat.getLeafOfNode(
                      chat.messages,
                      siblings[nextIndex].id,
                    );
                    chat.setCurrentLeafId(newLeaf);
                  }
                };

                return (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    selectedVoiceName={selectedVoiceName}
                    onEdit={(id, newText) => chat.handleSend(newText, id)}
                    siblingCount={siblingCount}
                    siblingIndex={siblingIndex}
                    onNavigateSibling={handleNavigateSibling}
                  />
                );
              })}
              <div ref={bottomRef} className="h-4" />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="absolute bottom-6 left-4 right-4 text-left md:left-8 md:right-8 lg:left-12 lg:right-12 xl:max-w-4xl xl:mx-auto">
          {/* Floating action buttons above the input */}
          <div className="absolute bottom-full mb-4 w-full flex justify-center items-end pointer-events-none z-40">
            <div className="pointer-events-auto">
              <AnimatePresence>
                {showScrollButton && chat.activeMessages.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: 20 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={scrollButtonDirection === "up" ? scrollToTop : scrollToBottom}
                    className="flex flex-col items-center justify-center w-10 h-10 md:w-12 md:h-12 bg-background/90 hover:bg-background text-foreground backdrop-blur-md rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-border/80 hover:border-primary/50 transition-all focus:outline-none group"
                    title={scrollButtonDirection === "up" ? "Scroll to top" : "Scroll to bottom"}
                  >
                    {scrollButtonDirection === "up" ? (
                      <ArrowUp
                        size={20}
                        className="text-primary group-hover:-translate-y-1 transition-transform duration-300"
                      />
                    ) : (
                      <ArrowDown
                        size={20}
                        className="text-primary group-hover:translate-y-1 transition-transform duration-300"
                      />
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Glass input panel */}
          <div className="relative flex flex-col glass-panel rounded-[24px] overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all shadow-xl p-1">
            {/* Attachment previews */}
            {chat.attachments.length > 0 && (
              <div className="flex gap-3 px-3 pt-3 pb-1 overflow-x-auto">
                {chat.attachments.map((att, index) => (
                  <div key={index} className="relative flex-shrink-0 group">
                    <div className="w-16 h-16 rounded-xl border border-border bg-background/50 overflow-hidden flex flex-col items-center justify-center relative shadow-sm">
                      {att.mimeType.startsWith("image/") ? (
                        <img
                          src={`data:${att.mimeType};base64,${att.data}`}
                          alt="preview"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <>
                          <FileText size={20} className="text-muted-foreground mb-1" />
                          <span className="text-[9px] font-medium text-muted-foreground w-full px-1 text-center truncate">
                            {att.name.split(".").pop()?.toUpperCase()}
                          </span>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => chat.removeAttachment(index)}
                      className="absolute -top-2 -right-2 bg-background border border-border text-muted-foreground hover:text-destructive rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-1 w-full bg-transparent">
              <div className="flex pb-1 pl-1 items-center gap-1">
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  className="hidden"
                  onChange={chat.handleFileChange}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-full h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Attach files (Images, Docs)"
                >
                  <Paperclip size={18} />
                </Button>
              </div>

              <Textarea
                dir="auto"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Syntax AI..."
                className="border-0 focus-visible:ring-0 resize-none max-h-48 shadow-none bg-transparent py-2.5 px-2 text-[15px] placeholder-muted-foreground/70 text-foreground w-full flex-1 min-h-[40px] leading-relaxed"
                rows={1}
              />

              <div className="flex items-center gap-1 pb-1 pr-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleRecording}
                  className={cn(
                    "rounded-full h-9 w-9 transition-all",
                    isRecording
                      ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                  title={isRecording ? "Stop recording" : "Voice input"}
                >
                  <Mic size={18} className={isRecording ? "animate-pulse" : ""} />
                </Button>
                <Button
                  onClick={chat.isLoading ? chat.handleStop : () => chat.handleSend()}
                  disabled={
                    !chat.isLoading &&
                    !input.trim() &&
                    chat.attachments.length === 0
                  }
                  size="icon"
                  className={cn(
                    "rounded-full h-9 w-9 shrink-0 transition-all duration-200",
                    chat.isLoading
                      ? "bg-red-500 hover:bg-red-600 text-white shadow-md hover:shadow-red-500/25 hover:scale-105 active:scale-95"
                      : (!input.trim() && chat.attachments.length === 0)
                        ? "bg-muted text-muted-foreground shadow-none opacity-80"
                        : "bg-primary text-primary-foreground shadow-md hover:shadow-primary/25 hover:scale-105 active:scale-95",
                  )}
                  title={chat.isLoading ? "Stop generating" : "Send message"}
                >
                  {chat.isLoading ? (
                    <Square size={14} className="fill-current" />
                  ) : (
                    <ArrowUp size={18} strokeWidth={2.5} />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <div className="text-center text-[11px] text-muted-foreground/60 tracking-wider font-medium mt-4">
            Syntax AI can make mistakes. Please verify important information.
          </div>
        </div>
      </main>

      {/* ── Delete Confirmation Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {chat.sessionToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center text-left">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              onClick={() => chat.setSessionToDelete(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-input border border-border shadow-2xl rounded-2xl overflow-hidden z-[61] p-6 text-center"
            >
              <div className="mx-auto w-12 h-12 bg-destructive/10 text-destructive flex items-center justify-center rounded-full mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Delete Chat
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                Are you sure you want to delete this chat? This action cannot be
                undone.
              </p>
              <div className="flex gap-3 w-full">
                <Button
                  variant="secondary"
                  className="flex-1 bg-muted hover:bg-muted/80 text-foreground font-medium active:scale-95 transition-transform"
                  onClick={() => chat.setSessionToDelete(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium shadow-md shadow-red-900/20 active:scale-95 transition-transform"
                  onClick={() => chat.deleteSession(chat.sessionToDelete!)}
                >
                  Delete
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Settings Modal ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center text-left">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              onClick={() => setIsSettingsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-lg bg-input border border-border shadow-2xl rounded-2xl overflow-hidden z-10"
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Settings2 size={18} className="text-primary" />
                  Application Settings
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSettingsOpen(false)}
                  className="rounded-full"
                >
                  <X size={18} />
                </Button>
              </div>
              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">

                {/* Theme */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Theme Preference
                  </label>
                  <div className="flex gap-2">
                    <Button
                      variant={!isDarkMode ? "default" : "outline"}
                      className="flex-1 rounded-xl"
                      onClick={() => isDarkMode && toggleDarkMode()}
                    >
                      Light Mode
                    </Button>
                    <Button
                      variant={isDarkMode ? "default" : "outline"}
                      className="flex-1 rounded-xl"
                      onClick={() => !isDarkMode && toggleDarkMode()}
                    >
                      Dark Mode
                    </Button>
                  </div>
                </div>

                {/* Voice Input Language */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Voice Input Language
                  </label>
                  <select
                    value={speechLang}
                    onChange={(e) => setSpeechLang(e.target.value)}
                    className="w-full bg-input border border-border rounded-xl p-2.5 text-sm focus-visible:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
                  >
                    <option value="">Browser language (System Default)</option>
                    <option value="ar-EG">Arabic (Egypt)</option>
                    <option value="ar-SA">Arabic (Saudi Arabia)</option>
                    <option value="ar-AE">Arabic (UAE)</option>
                    <option value="en-US">English (US)</option>
                    <option value="en-GB">English (UK)</option>
                    <option value="es-ES">Spanish</option>
                    <option value="fr-FR">French</option>
                    <option value="de-DE">German</option>
                    <option value="it-IT">Italian</option>
                    <option value="zh-CN">Chinese (Simplified)</option>
                    <option value="ja-JP">Japanese</option>
                    <option value="ru-RU">Russian</option>
                    <option value="hi-IN">Hindi</option>
                    <option value="pt-BR">Portuguese (Brazil)</option>
                  </select>
                </div>

                {/* Assistant Voice */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Assistant Voice
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedVoiceName}
                      onChange={(e) => setSelectedVoiceName(e.target.value)}
                      className="flex-1 w-full bg-input border border-border rounded-xl p-2.5 text-sm focus-visible:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
                    >
                      {GEMINI_VOICES.map((voice, i) => (
                        <option key={i} value={voice.name}>
                          {voice.name} ({voice.lang}) — {voice.desc}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={previewVoice}
                      disabled={isPreviewingVoice}
                      className="shrink-0 rounded-xl"
                      title="Preview Voice"
                    >
                      {isPreviewingVoice ? (
                        <Volume2 size={16} className="animate-pulse" />
                      ) : (
                        <Play size={16} />
                      )}
                    </Button>
                  </div>
                </div>


                {/* Core Memory */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground flex items-center justify-between">
                    Core Memory
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded uppercase font-bold tracking-wider">
                      Learned Facts
                    </span>
                  </label>
                  <Textarea
                    value={chat.coreMemory}
                    onChange={(e) => {
                      chat.setCoreMemory(e.target.value);
                      localStorage.setItem("syntax_core_memory", e.target.value);
                    }}
                    placeholder="No memories saved yet. The AI will remember important facts you tell it."
                    className="text-sm h-24 font-mono"
                  />
                  <div className="flex justify-between items-center mt-1">
                    <p className="text-xs text-muted-foreground">
                      Edit or clear the AI's permanent memory.
                    </p>
                    {chat.coreMemory && (
                      <button
                        onClick={() => {
                          if (confirm("Are you sure you want to clear all memory?")) {
                            chat.setCoreMemory("");
                            localStorage.removeItem("syntax_core_memory");
                          }
                        }}
                        className="text-xs text-red-500 hover:text-red-600 transition-colors"
                      >
                        Clear Memory
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-border flex justify-end">
                <Button onClick={() => setIsSettingsOpen(false)}>
                  Save & Close
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
