"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, RefreshCw } from "lucide-react";
import { Flight, FlightCard } from "./FlightCard";
import { AiReportPanel, ChatPanel } from "./AiRecommendationCard";
import { AiSkeletonLoader } from "./SkeletonLoaders";

interface ResultsSectionProps {
  isLoading: boolean;
  bestFlights: Flight[];
  otherFlights: Flight[];
  aiReport: string | null;
  hasSearched: boolean;
  onNewSearch: () => void;
}

export function ResultsSection({
  isLoading,
  bestFlights,
  otherFlights,
  aiReport,
  hasSearched,
  onNewSearch,
}: ResultsSectionProps) {
  const [activeTab, setActiveTab] = useState<"best" | "other">("best");
  const [isChatOpen, setIsChatOpen] = useState(false);

  if (!hasSearched) return null;

  const activeFlights = activeTab === "best" ? bestFlights : otherFlights;

  return (
    <div className="w-full max-w-4xl mx-auto py-10 px-4 md:px-0">
      <div className="flex flex-col gap-8">

        {/* ── AI Report (always first) ── */}
        {isLoading ? (
          <AiSkeletonLoader />
        ) : aiReport ? (
          <AiReportPanel report={aiReport} />
        ) : null}

        {/* ── Flight tabs (only shown after report is ready) ── */}
        {!isLoading && aiReport && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="w-full"
          >
            {/* Section label */}
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-4">
              Available Flights
            </p>

            {/* Tab toggle */}
            <div className="flex items-center gap-1 mb-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1 w-full shadow-sm">
              {(["best", "other"] as const).map((tab) => {
                const count = tab === "best" ? bestFlights.length : otherFlights.length;
                const label = tab === "best" ? "Best Flights" : "Other Flights";
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-200 ${
                      isActive
                        ? "bg-[var(--foreground)] text-[var(--background)] shadow-md"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                        isActive
                          ? "bg-[var(--background)] text-[var(--foreground)]"
                          : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Flight list */}
            <p className="mb-4 text-sm font-semibold text-[var(--muted-foreground)]">
              {activeFlights.length} flight{activeFlights.length !== 1 ? "s" : ""} found
            </p>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {activeFlights.length > 0 ? (
                  activeFlights.map((flight, idx) => (
                    <FlightCard key={`${flight.flight_number}-${idx}`} flight={flight} index={idx} />
                  ))
                ) : (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-12 text-center">
                    <p className="text-base font-medium text-[var(--foreground)]">No flights found.</p>
                    <p className="text-sm text-[var(--muted-foreground)] mt-2">Try adjusting your search criteria.</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── Action buttons + chat (only shown after report & flights are ready) ── */}
        {!isLoading && aiReport && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.35 }}
              className="flex gap-3"
            >
              <button
                onClick={() => setIsChatOpen((v) => !v)}
                className="flex-1 flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--accent)] hover:-translate-y-0.5 transition-all duration-200 shadow-sm"
              >
                <MessageSquare className="h-4 w-4" style={{ color: "var(--cyan)" }} />
                Ask about this report
              </button>
              <button
                onClick={onNewSearch}
                className="flex-1 flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold hover:opacity-90 hover:-translate-y-0.5 transition-all duration-200 shadow-sm"
                style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                <RefreshCw className="h-4 w-4" />
                New search
              </button>
            </motion.div>

            <AnimatePresence>
              {isChatOpen && (
                <ChatPanel reportText={aiReport} onClose={() => setIsChatOpen(false)} />
              )}
            </AnimatePresence>
          </>
        )}

      </div>
    </div>
  );
}
