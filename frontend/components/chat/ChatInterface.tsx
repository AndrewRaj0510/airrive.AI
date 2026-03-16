"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Plane } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Flight } from "@/components/results/FlightCard";

type Message =
  | { id: number; role: "bot" | "user"; type: "text"; text: string }
  | { id: number; role: "bot"; type: "flights"; flights: Flight[] };

interface ChatInterfaceProps {
  onSearch: (params: { origin: string; destination: string; outboundDate: string }) => void;
  onNewSearch: () => void;
  isSearching: boolean;
  hasSearched: boolean;
  aiReport: string | null;
  searchError: string | null;
  bestFlights: Flight[];
  searchId: number | null;
}

// ── Rich text renderers for bot messages ──────────────────────────────────────
function renderInline(text: string, key: number) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span key={key}>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-[var(--foreground)] dark:text-[var(--cyan)]">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        )
      )}
    </span>
  );
}

function renderBotText(text: string) {
  const lines = text.split("\n");
  return (
    <div>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-2.5" />;
        if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
          return (
            <p key={i} className="text-sm font-bold text-[var(--foreground)] dark:text-[var(--cyan)] mt-3 mb-0.5 first:mt-0">
              {trimmed.slice(2, -2)}
            </p>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed text-[var(--foreground)] dark:text-[var(--cyan)]">
            {renderInline(trimmed, i)}
          </p>
        );
      })}
    </div>
  );
}

function formatTime(timeStr: string): string {
  try {
    const date = new Date(timeStr.replace(" ", "T"));
    if (isNaN(date.getTime())) return timeStr.split(" ")[1] || timeStr;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return timeStr.split(" ")[1] || timeStr;
  }
}

function CompactFlightCard({ flight, index }: { flight: Flight; index: number }) {
  const dh = Math.floor(flight.duration_mins / 60);
  const dm = flight.duration_mins % 60;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.08 }}
      className="rounded-xl border border-[var(--border)] bg-white p-3"
    >
      {/* Airline + Price row */}
      <div className="flex items-start justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--muted)] shrink-0">
            <Plane className="h-3.5 w-3.5 text-[var(--foreground)]" />
          </div>
          <div>
            <p className="text-xs font-bold text-[var(--foreground)] leading-tight">{flight.airline_name}</p>
            <p className="text-[11px] text-[var(--muted-foreground)]">{flight.flight_number}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-[var(--foreground)]">₹{flight.price.toLocaleString("en-IN")}</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">per adult</p>
        </div>
      </div>

      {/* Times + route row */}
      <div className="flex items-center gap-2">
        <div className="text-center w-14">
          <p className="text-sm font-bold text-[var(--foreground)]">{formatTime(flight.departure_time)}</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">{flight.dep_iata}</p>
        </div>
        <div className="flex flex-col items-center flex-1">
          <p className="text-[10px] text-[var(--muted-foreground)]">{dh}h {dm}m</p>
          <div className="h-px w-full bg-[var(--border)] my-0.5" />
          <p className="text-[10px] font-semibold" style={{ color: "var(--cyan)" }}>
            {flight.stops === 0 ? "Direct" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="text-center w-14">
          <p className="text-sm font-bold text-[var(--foreground)]">{formatTime(flight.arrival_time)}</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">{flight.arrival_iata}</p>
        </div>
      </div>
    </motion.div>
  );
}

type Step = "origin" | "destination" | "date" | "done" | "chat";

// ── City → IATA lookup ─────────────────────────────────────────────────────────
const CITY_TO_IATA: Record<string, string> = {
  // India
  delhi: "DEL", newdelhi: "DEL",
  mumbai: "BOM", bombay: "BOM",
  bangalore: "BLR", bengaluru: "BLR",
  chennai: "MAA", madras: "MAA",
  kolkata: "CCU", calcutta: "CCU",
  hyderabad: "HYD",
  ahmedabad: "AMD",
  pune: "PNQ",
  goa: "GOI", panaji: "GOI", dabolim: "GOI",
  jaipur: "JAI",
  kochi: "COK", cochin: "COK",
  lucknow: "LKO",
  chandigarh: "IXC",
  nagpur: "NAG",
  patna: "PAT",
  bhubaneswar: "BBI",
  visakhapatnam: "VTZ", vizag: "VTZ", vishakhapatnam: "VTZ",
  srinagar: "SXR",
  amritsar: "ATQ",
  vadodara: "BDQ", baroda: "BDQ",
  indore: "IDR",
  bhopal: "BHO",
  coimbatore: "CJB",
  thiruvananthapuram: "TRV", trivandrum: "TRV",
  mangalore: "IXE", mangaluru: "IXE",
  guwahati: "GAU",
  varanasi: "VNS", benares: "VNS", kashi: "VNS",
  udaipur: "UDR",
  jodhpur: "JDH",
  leh: "IXL", ladakh: "IXL",
  aurangabad: "IXU",
  raipur: "RPR",
  ranchi: "IXR",
  dehradun: "DED",
  jammu: "IXJ",
  siliguri: "IXB", bagdogra: "IXB", darjeeling: "IXB",
  portblair: "IXZ", andaman: "IXZ",
  tiruchirappalli: "TRZ", trichy: "TRZ",
  madurai: "IXM",
  hubli: "HBX",
  belgaum: "IXG", belagavi: "IXG",
  // International
  london: "LHR", heathrow: "LHR",
  dubai: "DXB",
  singapore: "SIN",
  newyork: "JFK", nyc: "JFK",
  paris: "CDG",
  tokyo: "NRT",
  sydney: "SYD",
  bangkok: "BKK",
  kualalumpur: "KUL", kl: "KUL",
  hongkong: "HKG",
  toronto: "YYZ",
  frankfurt: "FRA",
  amsterdam: "AMS",
  doha: "DOH",
  abudhabi: "AUH",
  kathmandu: "KTM",
  colombo: "CMB",
  dhaka: "DAC",
  male: "MLE", maldives: "MLE",
  istanbul: "IST",
  beijing: "PEK",
  shanghai: "PVG",
  seoul: "ICN",
  losangeles: "LAX",
  chicago: "ORD",
  sanfrancisco: "SFO",
  miami: "MIA",
  vancouver: "YVR",
  melbourne: "MEL",
  johannesburg: "JNB",
  cairo: "CAI",
  nairobi: "NBO",
  rome: "FCO",
  barcelona: "BCN",
  madrid: "MAD",
  moscow: "SVO",
  muscat: "MCT",
  riyadh: "RUH",
  jeddah: "JED",
  karachi: "KHI",
  lahore: "LHE",
  manila: "MNL",
  jakarta: "CGK",
  taipei: "TPE",
  zurich: "ZRH",
  milan: "MXP",
  vienna: "VIE",
  brussels: "BRU",
  lisbon: "LIS",
  athens: "ATH",
  warsaw: "WAW",
  budapest: "BUD",
  prague: "PRG",
  stockholm: "ARN",
  oslo: "OSL",
  copenhagen: "CPH",
};

function resolveCity(input: string): { code: string; displayName: string } | null {
  const trimmed = input.trim();
  const normalized = trimmed.toLowerCase().replace(/[\s\-_]/g, "");

  // Already a 3-letter IATA code
  if (/^[a-zA-Z]{3}$/.test(trimmed)) {
    return { code: trimmed.toUpperCase(), displayName: trimmed.toUpperCase() };
  }

  const code = CITY_TO_IATA[normalized];
  if (code) {
    // Capitalise first letter for display
    const displayName = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    return { code, displayName };
  }

  return null;
}

// ── Date parser ────────────────────────────────────────────────────────────────
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDate(input: string): string | null {
  // Strip ordinal suffixes: 20th → 20, 1st → 1, 2nd → 2, 3rd → 3
  const cleaned = input.trim().replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");

  // Try JS native parser first (handles "20 Mar 2026", "March 20 2026", ISO, etc.)
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return toLocalDateString(d);

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const ddmmyyyy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (ddmmyyyy) {
    const d2 = new Date(+ddmmyyyy[3], +ddmmyyyy[2] - 1, +ddmmyyyy[1]);
    if (!isNaN(d2.getTime())) return toLocalDateString(d2);
  }

  // DD/MM/YY, DD-MM-YY, DD.MM.YY  (2-digit year → 2000s)
  const ddmmyy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/);
  if (ddmmyy) {
    const d2 = new Date(2000 + +ddmmyy[3], +ddmmyy[2] - 1, +ddmmyy[1]);
    if (!isNaN(d2.getTime())) return toLocalDateString(d2);
  }

  // "20 Mar" or "Mar 20" without year → assume next occurrence
  const noYear = cleaned.match(/^(\d{1,2})\s+([a-zA-Z]+)$|^([a-zA-Z]+)\s+(\d{1,2})$/);
  if (noYear) {
    const year = new Date().getFullYear();
    const attempt = new Date(`${cleaned} ${year}`);
    if (!isNaN(attempt.getTime())) return toLocalDateString(attempt);
  }

  return null;
}

// ── Initial state ──────────────────────────────────────────────────────────────
const INITIAL_MESSAGES: Message[] = [
  {
    id: 1,
    role: "bot",
    type: "text",
    text: "Hey! I'll help you find the best flight. Where are you flying from?",
  },
];

// ── Component ─────────────────────────────────────────────────────────────────
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export function ChatInterface({ onSearch, onNewSearch, isSearching, hasSearched, aiReport, searchError, bestFlights, searchId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<Step>("origin");
  const [origin, setOrigin] = useState<{ code: string; displayName: string } | null>(null);
  const [dest, setDest] = useState<{ code: string; displayName: string } | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<Array<{ role: string; content: string }>>([]);
  const reportRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(2);
  const prevHasSearched = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSearching]);

  // Reset only when hasSearched transitions true → false (New Search clicked)
  useEffect(() => {
    if (prevHasSearched.current && !hasSearched) {
      setMessages(INITIAL_MESSAGES);
      nextId.current = 2;
      setStep("origin");
      setOrigin(null);
      setDest(null);
      setInput("");
      setChatHistory([]);
      reportRef.current = null;
    }
    prevHasSearched.current = hasSearched;
  }, [hasSearched]);

  // Post the AI report and switch to chat mode
  useEffect(() => {
    if (aiReport) {
      reportRef.current = aiReport;
      setChatHistory([]);
      const reportId = nextId.current++;
      setMessages((prev) => [...prev, { id: reportId, role: "bot", type: "text", text: aiReport }]);
      setStep("chat");
    }
  }, [aiReport]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show error in chat and let user try again
  useEffect(() => {
    if (searchError) {
      const id = nextId.current++;
      setMessages((prev) => [...prev, { id, role: "bot", type: "text", text: `Sorry, something went wrong: ${searchError}` }]);
      setStep("origin");
      setOrigin(null);
      setDest(null);
    }
  }, [searchError]);

  const addBotMessage = (text: string, delay = 400) => {
    const id = nextId.current++;
    setTimeout(() => {
      setMessages((prev) => [...prev, { id, role: "bot", type: "text", text }]);
    }, delay);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = input.trim();
    if (!val || isSearching || step === "done") return;

    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", type: "text", text: val }]);
    setInput("");

    if (step === "chat") {
      if (isChatLoading) return;
      const lower = val.toLowerCase();

      const wantsFlights =
        lower === "1" ||
        lower.includes("recommend") ||
        lower.includes("best flight") ||
        lower.includes("see flight");

      const wantsDelayReport =
        lower === "2" ||
        lower.includes("delay pattern");

      const wantsBestTime =
        lower === "3" ||
        lower.includes("best time") ||
        lower.includes("time to fly");

      const wantsAirportReport =
        lower === "4" ||
        lower.includes("airport reliability");

      if (wantsFlights && bestFlights.length > 0) {
        const labelId = nextId.current++;
        const flightsId = nextId.current++;
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            { id: labelId, role: "bot", type: "text", text: "Here are the best flights I recommend:" },
            { id: flightsId, role: "bot", type: "flights", flights: bestFlights },
          ]);
        }, 400);
        return;
      }

      if (wantsDelayReport && searchId) {
        setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: "Generating delay pattern report..." }]);
        fetch(`${API_BASE_URL}/api/delay-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ search_id: searchId }),
        })
          .then((r) => r.json())
          .then((data) => {
            const reportText = data.report || data.error || "Could not generate delay report.";
            setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: reportText }]);
          })
          .catch(() => {
            setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: "Failed to fetch delay report. Please try again." }]);
          });
        return;
      }

      if (wantsBestTime && searchId) {
        setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: "Generating best time to fly report..." }]);
        fetch(`${API_BASE_URL}/api/best-time-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ search_id: searchId }),
        })
          .then((r) => r.json())
          .then((data) => {
            const reportText = data.report || data.error || "Could not generate report.";
            setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: reportText }]);
          })
          .catch(() => {
            setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: "Failed to fetch best time report. Please try again." }]);
          });
        return;
      }

      if (wantsAirportReport) {
        setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: "Generating airport reliability report..." }]);
        fetch(`${API_BASE_URL}/api/airport-reliability`, { method: "POST" })
          .then((r) => r.json())
          .then((data) => {
            const reportText = data.report || data.error || "Could not generate airport reliability report.";
            setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: reportText }]);
          })
          .catch(() => {
            setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: "Failed to fetch airport reliability report. Please try again." }]);
          });
        return;
      }

      // Free-form fallback — send to /api/chat
      const userMsg = { role: "user", content: val };
      const newHistory = [...chatHistory, userMsg];
      setChatHistory(newHistory);
      setIsChatLoading(true);
      fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: { report: reportRef.current }, messages: newHistory, search_id: searchId }),
      })
        .then((r) => r.json())
        .then((data) => {
          const reply = data.reply || "Sorry, I couldn't generate a response.";
          setChatHistory((prev) => [...prev, { role: "assistant", content: reply }]);
          setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: reply }]);
        })
        .catch(() => {
          setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", type: "text", text: "Failed to get a response. Please try again." }]);
        })
        .finally(() => setIsChatLoading(false));
      return;
    }

    if (step === "origin") {
      const resolved = resolveCity(val);
      if (!resolved) {
        addBotMessage("I don't recognise that city. Try typing the full city name (e.g. Delhi, Mumbai, London).");
        return;
      }
      setOrigin(resolved);
      addBotMessage(`Got it, flying from ${resolved.displayName} (${resolved.code}). Where are you headed?`);
      setStep("destination");

    } else if (step === "destination") {
      const resolved = resolveCity(val);
      if (!resolved) {
        addBotMessage("I don't recognise that city. Try typing the full city name (e.g. Delhi, Mumbai, London).");
        return;
      }
      setDest(resolved);
      addBotMessage(`${origin!.displayName} → ${resolved.displayName}, got it! What date are you flying? (e.g. 25 Mar 2026)`);
      setStep("date");

    } else if (step === "date") {
      const dateStr = parseDate(val);
      if (!dateStr) {
        addBotMessage("I couldn't read that date. Try something like '25 Mar 2026' or '2026-03-25'.");
        return;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const flightDate = new Date(dateStr);
      if (flightDate < today) {
        addBotMessage("That date is in the past. Please enter a future date.");
        return;
      }

      const displayDate = flightDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

      addBotMessage(`Searching flights from ${origin!.displayName} to ${dest!.displayName} on ${displayDate}...`);
      setStep("done");
      setTimeout(() => onSearch({ origin: origin!.code, destination: dest!.code, outboundDate: dateStr }), 800);
    }
  };

  const placeholder =
    step === "origin" ? "Type a city (e.g. Delhi, Mumbai)..."
      : step === "destination" ? "Type destination city (e.g. Goa, London)..."
        : step === "date" ? "Type date (e.g. 25 Mar 2026)..."
          : step === "chat" ? "Ask me anything about your flights..."
            : "Please wait...";

  return (
    <>
      {/* ── Messages — inline in document flow, push page down ── */}
      <div className="w-full max-w-2xl mx-auto px-4 pt-2 pb-4">
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.type === "flights" ? (
                  <div className="w-full flex flex-col gap-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)] px-1">
                      Best Flights · {msg.flights.length} found
                    </p>
                    {msg.flights.map((flight, idx) => (
                      <CompactFlightCard key={`${flight.flight_number}-${idx}`} flight={flight} index={idx} />
                    ))}
                  </div>
                ) : (
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-2.5 shadow-sm ${
                      msg.role === "user"
                        ? "bg-[var(--foreground)] text-[var(--background)] rounded-br-sm text-sm font-medium leading-relaxed"
                        : "bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] rounded-bl-sm"
                    }`}
                  >
                    {msg.role === "user" ? msg.text : renderBotText(msg.text)}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Typing indicator while API is running */}
          {isSearching && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5 shadow-sm">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-[var(--muted-foreground)]"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity }}
                  />
                ))}
              </div>
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar — fixed at viewport bottom ── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-md px-4 py-4">
        {step === "chat" ? (
          <div className="w-full max-w-2xl mx-auto flex flex-col gap-2">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={placeholder}
                disabled={isChatLoading}
                className="flex-1 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:ring-2 focus:ring-[var(--foreground)] disabled:opacity-50 transition"
              />
              <button
                type="submit"
                disabled={!input.trim() || isChatLoading}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)] disabled:opacity-40 hover:opacity-80 transition active:scale-95 shrink-0"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
            <button
              onClick={onNewSearch}
              className="w-full rounded-full border border-black bg-black text-white dark:border-[var(--border)] dark:bg-transparent dark:text-white hover:opacity-80 transition text-xs font-semibold px-5 py-2"
            >
              New Search
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-2xl mx-auto flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              disabled={isSearching}
              className="flex-1 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:ring-2 focus:ring-[var(--foreground)] disabled:opacity-50 transition"
            />
            <button
              type="submit"
              disabled={!input.trim() || isSearching}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)] disabled:opacity-40 hover:opacity-80 transition active:scale-95 shrink-0"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>
    </>
  );
}
