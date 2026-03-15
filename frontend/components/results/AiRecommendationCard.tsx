"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles, MessageSquare, Send, X } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

type ChatMessage = { role: "user" | "assistant"; content: string };

// ─── Chat panel ───────────────────────────────────────────────────────────────

export function ChatPanel({ reportText, onClose }: { reportText: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: { analysis: reportText }, messages: nextMessages }),
      });
      if (!res.ok) throw new Error("Chat request failed");
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't process that. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" style={{ color: "var(--cyan)" }} />
          <span className="text-sm font-semibold text-[var(--foreground)]">Ask about this report</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="h-72 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-[var(--muted-foreground)]">
            <Sparkles className="h-7 w-7 opacity-40" style={{ color: "var(--cyan)" }} />
            <p className="text-sm font-medium">Ask anything about this report</p>
            <p className="text-xs opacity-60">
              e.g. &quot;Which flight has the least delays?&quot; or &quot;Is the price expected to drop?&quot;
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "text-white rounded-br-sm"
                  : "bg-[var(--muted)] text-[var(--foreground)] rounded-bl-sm border border-[var(--border)]"
              }`}
              style={msg.role === "user" ? { backgroundColor: "var(--dark-blue)" } : {}}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[var(--muted)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-[var(--muted-foreground)]"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-[var(--border)]">
        <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 focus-within:border-[var(--cyan)] transition-colors">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Ask a follow-up question..."
            className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="rounded-full p-1.5 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--dark-blue)" }}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function AiReportPanel({
  report,
}: {
  report: string;
}) {
  // Parse report: split sections on blank lines, detect **Heading** lines
  const sections = report.split(/\n\n+/).filter((s) => s.trim().length > 0);

  const isHeading = (text: string) => /^\*\*[^*]+\*\*$/.test(text.trim());
  const headingText = (text: string) => text.trim().replace(/^\*\*|\*\*$/g, "");

  // Render inline text — handles **bold** within a line
  const renderInline = (text: string, key: number) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={key}>
        {parts.map((part, i) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={i} className="font-semibold text-[var(--foreground)]">
              {part.slice(2, -2)}
            </strong>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  // Render a section block (may contain multiple lines)
  const renderLines = (block: string, blockIdx: number) =>
    block
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((line, li) => (
        <p key={li} className="text-[14px] leading-7 text-[var(--foreground)]">
          {renderInline(line.trim(), blockIdx * 100 + li)}
        </p>
      ));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-5"
    >
      {/* Report card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">

        {/* Cyan top accent bar */}
        <div className="h-1 w-full" style={{ backgroundColor: "var(--cyan)" }} />

        {/* Header */}
        <div className="flex items-center gap-3 px-7 pt-6 pb-2">
          <Sparkles className="h-5 w-5 shrink-0" style={{ color: "var(--cyan)" }} />
          <div>
            <h2 className="text-lg font-bold text-[var(--foreground)] tracking-tight">
              Flight Intelligence Report
            </h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              AI analysis · Historical reliability · Live pricing
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-7 mt-4 mb-6 h-px bg-[var(--border)]" />

        {/* Report sections */}
        <div className="px-7 pb-7 space-y-6">
          {sections.map((section, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.07 }}
            >
              {isHeading(section) ? (
                /* Section heading */
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-3.5 w-0.5 rounded-full shrink-0" style={{ backgroundColor: "var(--cyan)" }} />
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-[var(--foreground)]">
                    {headingText(section)}
                  </h3>
                </div>
              ) : (
                /* Body block */
                <div className="space-y-1.5 pl-3">
                  {renderLines(section, i)}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
