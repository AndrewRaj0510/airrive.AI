"use client";

import { useState } from "react";
import { ArrowLeftRight, Users, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const formatISO = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;


import { TripTypeDropdown } from "./TripTypeDropdown";
import { AirportInput } from "./AirportInput";
import { DatePicker } from "./DatePicker";

interface SearchBarProps {
  onSearch: (searchParams: {
    origin: string;
    destination: string;
    outboundDate: string;
    returnDate: string | null;
    tripType: "One-way" | "Round trip";
  }) => void;
  isSearching: boolean;
}

export function SearchBar({ onSearch, isSearching }: SearchBarProps) {
  const [tripType, setTripType] = useState<"One-way" | "Round trip">("One-way");
  const [origin, setOrigin] = useState("DEL");
  const [destination, setDestination] = useState("BOM");
  
  const today = new Date();
  const [outboundDate, setOutboundDate] = useState<Date | null>(today);
  const [returnDate, setReturnDate] = useState<Date | null>(null);

  const handleSwap = () => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  };

  const handleSearchClick = () => {
    if (!origin || !destination || !outboundDate) return;
    
    // Convert dates to YYYY-MM-DD
    const outDateStr = formatISO(outboundDate);
    const retDateStr = tripType === "Round trip" && returnDate 
      ? formatISO(returnDate) 
      : null;

    onSearch({
      origin,
      destination,
      outboundDate: outDateStr,
      returnDate: retDateStr,
      tripType
    });
  };

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col items-center">
      {/* Search Container */}
      <div className="w-full bg-[var(--card)] rounded-full shadow-lg border border-[var(--border)] p-2 backdrop-blur-md relative z-10">
        
        {/* Top-left attached Trip Type Dropdown */}
        <div className="absolute -top-10 left-4">
          <TripTypeDropdown value={tripType} onChange={(val) => {
            setTripType(val);
            if (val === "One-way") setReturnDate(null);
          }} />
        </div>

        {/* The huge horizontal pill form */}
        <div className="flex w-full items-center relative rounded-full bg-[var(--card)] h-20">
          
          <AirportInput type="From" value={origin} onChange={setOrigin} />
          
          <div className="relative flex items-center justify-center">
            <div className="h-10 w-px bg-[var(--border)]" />
            <button
              onClick={handleSwap}
              className="absolute z-30 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--accent)] hover:shadow-md transition-all active:scale-95"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
          </div>

          <AirportInput type="To" value={destination} onChange={setDestination} />
          
          <div className="h-10 w-px bg-[var(--border)]" />

          <DatePicker 
            label="Depart" 
            value={outboundDate} 
            onChange={setOutboundDate} 
            minDate={today}
          />
          
          <div className="h-10 w-px bg-[var(--border)]" />

          {/* Animated Return Date Field */}
          <AnimatePresence initial={false}>
            {tripType === "Round trip" && (
              <motion.div
                className="flex-1 h-full"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1, flex: 1 }}
                exit={{ width: 0, opacity: 0, flex: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                <DatePicker 
                  label="Return" 
                  value={returnDate} 
                  onChange={setReturnDate} 
                  minDate={outboundDate || today}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {(tripType === "Round trip") && <div className="h-10 w-px bg-[var(--border)]" />}

          {/* Travelers - Mock Static Field */}
          <div
            className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-[var(--accent)] rounded-r-full cursor-pointer transition-colors h-full"
            onClick={() => alert("Passenger selection is a mock feature for this demo.")}
          >
            <div className="text-[var(--muted-foreground)]">
              <Users className="h-5 w-5" />
            </div>
            <div className="flex flex-col flex-1 overflow-hidden">
              <label className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                Travelers
              </label>
              <div className="text-lg font-bold text-[var(--foreground)]">
                1 Adult
              </div>
              <span className="text-xs text-[var(--muted-foreground)]">Economy</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Search Button Component */}
      <motion.button
        onClick={handleSearchClick}
        disabled={isSearching || !origin || !destination || !outboundDate}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="mt-6 flex h-16 items-center justify-center gap-3 rounded-full bg-[var(--foreground)] px-12 text-lg font-bold text-[var(--background)] shadow-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity z-0"
      >
        {isSearching ? (
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--background)] border-t-transparent" />
            <span>Searching...</span>
          </div>
        ) : (
          <>
            <Search className="h-6 w-6" />
            Search Flights
          </>
        )}
      </motion.button>
    </div>
  );
}
