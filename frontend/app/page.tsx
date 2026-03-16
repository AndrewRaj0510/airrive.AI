"use client";

import { useState } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import type { Flight } from "@/components/results/FlightCard";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [bestFlights, setBestFlights] = useState<Flight[]>([]);
  const [searchId, setSearchId] = useState<number | null>(null);

  const handleNewSearch = () => {
    setHasSearched(false);
    setAiReport(null);
    setSearchError(null);
    setIsLoading(false);
    setBestFlights([]);
    setSearchId(null);
  };

  const handleSearch = async (searchParams: {
    origin: string;
    destination: string;
    outboundDate: string;
  }) => {
    setHasSearched(true);
    setAiReport(null);
    setSearchError(null);
    setBestFlights([]);
    setIsLoading(true);

    try {
      const res1 = await fetch(`${API_BASE_URL}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: searchParams.origin,
          destination: searchParams.destination,
          outbound_date: searchParams.outboundDate,
          return_date: null,
        }),
      });

      if (!res1.ok) throw new Error("Failed to fetch flights");

      const data1 = await res1.json();

      if (!data1.search_id) {
        throw new Error("No flights found for this route and date.");
      }

      setBestFlights(data1.best_flights ?? []);
      setSearchId(data1.search_id);

      const res2 = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search_id: data1.search_id }),
      });

      if (!res2.ok) throw new Error("Failed to generate report.");

      const data2 = await res2.json();
      setAiReport(data2.report || null);

    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col relative w-full overflow-hidden min-h-screen pb-28">

      {/* Dot grid background */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* Hero */}
      <div className={`w-full flex flex-col items-center transition-all duration-700 ease-in-out ${hasSearched ? "pt-8 pb-6" : "justify-center min-h-[60vh]"}`}>
        <div className="text-center px-4">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-4">
            The arrival assistant for modern travel
          </p>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight text-[var(--foreground)] leading-tight">
            Check the Right Flight Status.{" "}
            <span style={{ color: "var(--cyan)" }}>Real Time.</span>
          </h1>
          <p className="text-base text-[var(--muted-foreground)] max-w-xl mx-auto mt-4 leading-relaxed">
            Live prices and a decisive AI verdict.
          </p>
        </div>
      </div>

      <ChatInterface
        onSearch={handleSearch}
        onNewSearch={handleNewSearch}
        isSearching={isLoading}
        hasSearched={hasSearched}
        aiReport={aiReport}
        searchError={searchError}
        bestFlights={bestFlights}
        searchId={searchId}
      />

    </div>
  );
}
