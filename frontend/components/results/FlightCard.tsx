"use client";

import { Plane } from "lucide-react";
import { motion } from "framer-motion";

export interface Flight {
  flight_number: string;
  airline_name: string;
  price: number;
  departure_time: string;
  arrival_time: string;
  duration_mins: number;
  stops: number;
  dep_iata: string;
  arrival_iata: string;
}

export function FlightCard({ flight, index }: { flight: Flight; index: number }) {
  const durationHours = Math.floor(flight.duration_mins / 60);
  const durationMins = flight.duration_mins % 60;

  // Format time from "2026-03-25 10:00" -> "10:00 AM"
  // Use T separator to avoid invalid date parsing in Safari/Firefox
  const formatTime = (timeStr: string) => {
    try {
      const date = new Date(timeStr.replace(" ", "T"));
      if (isNaN(date.getTime())) return timeStr.split(" ")[1] || timeStr;
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return timeStr.split(" ")[1] || timeStr;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="group flex flex-col md:flex-row items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
    >
      {/* Airline Info */}
      <div className="flex w-full md:w-1/4 items-center gap-4 mb-4 md:mb-0">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--foreground)]">
          <Plane className="h-6 w-6" />
        </div>
        <div>
          <h3 className="font-bold text-[var(--foreground)]">{flight.airline_name}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{flight.flight_number}</p>
        </div>
      </div>

      {/* Flight Path & Times */}
      <div className="flex w-full md:w-2/4 items-center justify-between px-4 mb-4 md:mb-0">
        <div className="text-center">
          <p className="text-2xl font-bold text-[var(--foreground)]">{formatTime(flight.departure_time)}</p>
          <p className="text-sm font-medium text-[var(--muted-foreground)]">{flight.dep_iata}</p>
        </div>

        <div className="flex flex-col items-center px-4 w-full">
          <p className="text-xs font-semibold text-[var(--muted-foreground)] mb-1">
            {durationHours}h {durationMins}m
          </p>
          <div className="relative flex w-full items-center">
            <div className="h-px w-full bg-[var(--border)]" />
            <Plane className="absolute left-1/2 -translate-x-1/2 text-[var(--muted-foreground)] h-4 w-4 bg-[var(--card)] px-0.5" />
          </div>
          <p className="text-xs font-semibold text-[var(--primary)] mt-1">
            {flight.stops === 0 ? "Direct" : `${flight.stops} Stop${flight.stops > 1 ? "s" : ""}`}
          </p>
        </div>

        <div className="text-center">
          <p className="text-2xl font-bold text-[var(--foreground)]">{formatTime(flight.arrival_time)}</p>
          <p className="text-sm font-medium text-[var(--muted-foreground)]">{flight.arrival_iata}</p>
        </div>
      </div>

      {/* Price & Action */}
      <div className="flex w-full md:w-1/4 flex-col items-end md:border-l border-[var(--border)] md:pl-6">
        <p className="text-2xl font-bold text-[var(--foreground)]">₹{flight.price.toLocaleString("en-IN")}</p>
        <p className="text-xs text-[var(--muted-foreground)] mb-3">per adult</p>
        <button className="w-full rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-bold text-[var(--background)] hover:opacity-80 active:scale-95 transition-all duration-150">
          Select
        </button>
      </div>
    </motion.div>
  );
}
