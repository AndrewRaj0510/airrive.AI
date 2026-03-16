"use client";

import { motion } from "framer-motion";
import { Flight, FlightCard } from "./FlightCard";
import { AiReportPanel } from "./AiRecommendationCard";
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
}: ResultsSectionProps) {

  if (!hasSearched) return null;

  return (
    <div className="w-full max-w-4xl mx-auto py-10 px-4 md:px-0">
      <div className="flex flex-col gap-8">

        {/* ── AI Report ── */}
        {isLoading ? (
          <AiSkeletonLoader />
        ) : aiReport ? (
          <AiReportPanel report={aiReport} />
        ) : null}

        {/* ── Flights (shown after report is ready) ── */}
        {!isLoading && aiReport && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="w-full flex flex-col gap-4"
          >
            {/* Other Flights */}
            {otherFlights.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-4">
                  Other Flights · {otherFlights.length} found
                </p>
                <div className="space-y-4">
                  {otherFlights.map((flight, idx) => (
                    <FlightCard key={`other-${flight.flight_number}-${idx}`} flight={flight} index={idx} />
                  ))}
                </div>
              </div>
            )}

            {/* Separator */}
            {bestFlights.length > 0 && (
              <div className="flex items-center gap-4 my-2">
                <div className="flex-1 h-px bg-[var(--border)]" />
                <p className="text-sm font-semibold text-[var(--foreground)] whitespace-nowrap">
                  These are the best flights, I recommend
                </p>
                <div className="flex-1 h-px bg-[var(--border)]" />
              </div>
            )}

            {/* Best Flights */}
            {bestFlights.length > 0 && (
              <div className="space-y-4">
                {bestFlights.map((flight, idx) => (
                  <FlightCard key={`best-${flight.flight_number}-${idx}`} flight={flight} index={idx} />
                ))}
              </div>
            )}

            {/* Empty state */}
            {bestFlights.length === 0 && otherFlights.length === 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-12 text-center">
                <p className="text-base font-medium text-[var(--foreground)]">No flights found.</p>
                <p className="text-sm text-[var(--muted-foreground)] mt-2">Try a different route or date.</p>
              </div>
            )}
          </motion.div>
        )}


      </div>
    </div>
  );
}
