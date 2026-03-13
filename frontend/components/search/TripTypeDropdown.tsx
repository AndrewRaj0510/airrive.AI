"use client";

import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface TripTypeDropdownProps {
  value: "One-way" | "Round trip";
  onChange: (value: "One-way" | "Round trip") => void;
}

export function TripTypeDropdown({ value, onChange }: TripTypeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative mb-2 inline-block z-20" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
      >
        {value}
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-40 rounded-md border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onChange("One-way");
              setIsOpen(false);
            }}
            className={`w-full px-4 py-2 text-left text-sm hover:bg-[var(--accent)] ${
              value === "One-way" ? "bg-[var(--accent)] font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            One-way
          </button>
          <button
            type="button"
            onClick={() => {
              onChange("Round trip");
              setIsOpen(false);
            }}
            className={`w-full px-4 py-2 text-left text-sm hover:bg-[var(--accent)] ${
              value === "Round trip" ? "bg-[var(--accent)] font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
            }`}
          >
            Round trip
          </button>
        </div>
      )}
    </div>
  );
}
