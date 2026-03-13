"use client";

import { useState, useRef, useEffect } from "react";
import { PlaneTakeoff, PlaneLanding, MapPin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Airport {
  iata: string;
  city: string;
  name: string;
  aliases?: string[];
}

const INDIAN_AIRPORTS: Airport[] = [
  { iata: "DEL", city: "Delhi", name: "Indira Gandhi Int'l Airport", aliases: ["New Delhi", "Delhi"] },
  { iata: "BOM", city: "Mumbai", name: "Chhatrapati Shivaji Maharaj Int'l Airport" },
  { iata: "MAA", city: "Chennai", name: "Chennai Int'l Airport" },
  { iata: "HYD", city: "Hyderabad", name: "Rajiv Gandhi Int'l Airport" },
  { iata: "CCU", city: "Kolkata", name: "Netaji Subhas Chandra Bose Int'l Airport", aliases: ["Calcutta", "Kolkata"] },
  { iata: "BLR", city: "Bengaluru", name: "Kempegowda Int'l Airport", aliases: ["Bangalore", "Bengaluru"] },
  { iata: "PNQ", city: "Pune", name: "Pune Airport" },
];

interface AirportInputProps {
  type: "From" | "To";
  value: string; // The IATA code
  onChange: (iata: string) => void;
}

export function AirportInput({ type, value, onChange }: AirportInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync internal search term when external value changes (e.g., via Swap button)
  useEffect(() => {
    setSearchTerm(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm(value);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value]);

  const filteredAirports = INDIAN_AIRPORTS.filter((a) => {
    const q = searchTerm.toLowerCase();
    return (
      a.city.toLowerCase().includes(q) ||
      a.iata.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      (a.aliases ?? []).some((alias) => alias.toLowerCase().includes(q))
    );
  });

  const selectedAirport = INDIAN_AIRPORTS.find((a) => a.iata === value);

  const handleSelect = (airport: Airport) => {
    onChange(airport.iata);
    setSearchTerm(airport.iata);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      setSearchTerm(value);
    }
  };

  return (
    <div className="relative flex-1 group" ref={dropdownRef}>
      <div
        className={`flex items-center gap-3 px-4 py-3 cursor-text transition-colors h-full ${
          type === "From" ? "rounded-l-full" : ""
        } ${isOpen ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]"}`}
        onClick={() => {
          setIsOpen(true);
          setSearchTerm("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <div className="text-[var(--muted-foreground)]">
          {type === "From" ? <PlaneTakeoff className="h-5 w-5" /> : <PlaneLanding className="h-5 w-5" />}
        </div>
        <div className="flex flex-col flex-1 overflow-hidden">
          <label className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
            {type}
          </label>
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-lg font-bold text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] placeholder:font-normal focus:outline-none"
            placeholder={type === "From" ? "Origin city" : "Destination city"}
            value={isOpen ? searchTerm : selectedAirport ? selectedAirport.city : searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => {
              setIsOpen(true);
              setSearchTerm("");
            }}
            onKeyDown={handleKeyDown}
          />
          {!isOpen && selectedAirport && (
            <span className="text-xs text-[var(--muted-foreground)] truncate">
              {selectedAirport.iata} • {selectedAirport.name}
            </span>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute left-0 top-[110%] z-50 mt-2 w-[340px] rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-2xl max-h-80 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-bold text-[var(--muted-foreground)] mb-2 px-3 uppercase tracking-wider">
              Suggested Airports
            </div>
            {filteredAirports.length > 0 ? (
              filteredAirports.map((airport) => (
                <button
                  type="button"
                  key={airport.iata}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-[var(--accent)] transition-colors group/item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(airport);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-[var(--muted-foreground)] group-hover/item:text-[var(--foreground)] transition-colors">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-bold text-[var(--foreground)]">{airport.city}</span>
                      <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[200px]">{airport.name}</span>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-[var(--muted-foreground)] bg-[var(--muted)] px-2 py-1 rounded-md shrink-0">
                    {airport.iata}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">
                No airports found
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
