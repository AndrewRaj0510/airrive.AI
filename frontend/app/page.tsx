"use client";

import { useState } from "react";
import { SearchBar } from "@/components/search/SearchBar";
import { ResultsSection } from "@/components/results/ResultsSection";
import { Flight } from "@/components/results/FlightCard";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const [bestFlights, setBestFlights] = useState<Flight[]>([]);
  const [otherFlights, setOtherFlights] = useState<Flight[]>([]);
  const [aiReport, setAiReport] = useState<string | null>(null);

  const handleNewSearch = () => {
    setHasSearched(false);
    setBestFlights([]);
    setOtherFlights([]);
    setAiReport(null);
    setIsLoading(false);
  };

  const handleSearch = async (searchParams: {
    origin: string;
    destination: string;
    outboundDate: string;
    returnDate: string | null;
    tripType: "One-way" | "Round trip";
  }) => {
    setHasSearched(true);
    setBestFlights([]);
    setOtherFlights([]);
    setAiReport(null);
    setIsLoading(true);

    try {
      // Step 1: Fetch live flights
      const res1 = await fetch(`${API_BASE_URL}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: searchParams.origin,
          destination: searchParams.destination,
          outbound_date: searchParams.outboundDate,
          return_date: searchParams.returnDate,
        }),
      });

      if (!res1.ok) throw new Error("Failed to fetch flights");

      const data1 = await res1.json();
      setBestFlights(data1.best_flights || []);
      setOtherFlights(data1.other_flights || []);

      // Step 2: AI report — flights are held and shown only after report arrives
      if (data1.search_id) {
        const res2 = await fetch(`${API_BASE_URL}/api/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ search_id: data1.search_id }),
        });

        if (res2.ok) {
          const data2 = await res2.json();
          setAiReport(data2.report || null);
        }
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col relative w-full overflow-hidden min-h-screen">

      {/* Warm dot grid background */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* Hero */}
      <div className={`w-full flex flex-col items-center transition-all duration-700 ease-in-out ${hasSearched ? "pt-8 pb-6" : "justify-center min-h-[60vh]"}`}>

        <div className="text-center mb-10 px-4">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-4">
            The arrival assistant for modern travel
          </p>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight text-[var(--foreground)] leading-tight">
            Book the right flight.{" "}
            <span style={{ color: "var(--cyan)" }}>Every time.</span>
          </h1>
          <p className="text-base text-[var(--muted-foreground)] max-w-xl mx-auto mt-4 leading-relaxed">
            Live prices and a decisive AI verdict so you never second guess a booking again.
          </p>
        </div>

        <SearchBar onSearch={handleSearch} isSearching={isLoading} />

      </div>

      {/* Results */}
      <ResultsSection
        isLoading={isLoading}
        bestFlights={bestFlights}
        otherFlights={otherFlights}
        aiReport={aiReport}
        hasSearched={hasSearched}
        onNewSearch={handleNewSearch}
      />

    </div>
  );
}
