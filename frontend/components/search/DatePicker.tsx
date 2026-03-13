"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const formatISO = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const formatDisplay = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const formatDay = (date: Date) => date.toLocaleDateString("en-US", { weekday: "long" });

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface DatePickerProps {
  label: string;
  value: Date | null;
  onChange: (date: Date | null) => void;
  minDate?: Date;
}

export function DatePicker({ label, value, onChange, minDate }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [tempDate, setTempDate] = useState<Date | null>(value);

  // Independent calendar view state (not tied to selected date)
  const today = new Date();
  const initialMonth = value?.getMonth() ?? minDate?.getMonth() ?? today.getMonth();
  const initialYear = value?.getFullYear() ?? minDate?.getFullYear() ?? today.getFullYear();
  const [calendarMonth, setCalendarMonth] = useState(initialMonth);
  const [calendarYear, setCalendarYear] = useState(initialYear);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setTempDate(value);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value]);

  // When opening, jump calendar view to the selected or min date's month
  const handleOpen = () => {
    const base = value ?? minDate ?? today;
    setCalendarMonth(base.getMonth());
    setCalendarYear(base.getFullYear());
    setTempDate(value);
    setIsOpen(true);
  };

  const handleApply = () => {
    onChange(tempDate);
    setIsOpen(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    setTempDate(value);
  };

  const prevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear((y) => y - 1);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear((y) => y + 1);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  };

  // Build the calendar grid
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const startOffset = new Date(calendarYear, calendarMonth, 1).getDay(); // 0=Sun

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(calendarYear, calendarMonth, i + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Determine if prev-month navigation is allowed
  const todayNorm = new Date(today.getFullYear(), today.getMonth(), 1);
  const viewingNorm = new Date(calendarYear, calendarMonth, 1);
  const isPrevDisabled = viewingNorm <= todayNorm;

  return (
    <div className="relative flex-1 group h-full" ref={dropdownRef}>
      <div
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors h-full ${isOpen ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]"
          }`}
        onClick={handleOpen}
      >
        <div className="text-[var(--muted-foreground)]">
          <CalendarIcon className="h-5 w-5" />
        </div>
        <div className="flex flex-col flex-1 overflow-hidden">
          <label className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider cursor-pointer">
            {label}
          </label>
          <div className="text-lg font-bold text-[var(--foreground)] truncate">
            {value ? formatDisplay(value) : "Add date"}
          </div>
          <span className="text-xs text-[var(--muted-foreground)] truncate">
            {value ? formatDay(value) : "Select a day"}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute left-0 top-[110%] z-50 mt-2 w-[272px] rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Month / Year navigation header */}
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); prevMonth(); }}
                disabled={isPrevDisabled}
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--accent)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-3.5 w-3.5 text-[var(--foreground)]" />
              </button>

              <span className="text-sm font-bold text-[var(--foreground)]">
                {MONTH_NAMES[calendarMonth]} {calendarYear}
              </span>

              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); nextMonth(); }}
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--accent)] transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5 text-[var(--foreground)]" />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-[var(--muted-foreground)] mb-1">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-0.5">
              {/* Empty offset cells for the starting weekday */}
              {Array.from({ length: startOffset }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}

              {days.map((day, idx) => {
                let isDisabled = false;
                if (minDate) {
                  const dayStr = formatISO(day);
                  const minStr = formatISO(minDate);
                  isDisabled = dayStr < minStr;
                }

                const isSelected = tempDate && formatISO(tempDate) === formatISO(day);
                const isToday = formatISO(day) === formatISO(today);

                return (
                  <button
                    type="button"
                    key={idx}
                    disabled={isDisabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      setTempDate(day);
                    }}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-all duration-150 ${isDisabled
                        ? "text-[var(--muted-foreground)] cursor-not-allowed opacity-30"
                        : isSelected
                          ? "bg-[var(--foreground)] text-[var(--background)] font-bold shadow-md scale-105"
                          : isToday
                            ? "border border-[var(--foreground)] text-[var(--foreground)] hover:bg-[var(--accent)]"
                            : "hover:bg-[var(--accent)] text-[var(--foreground)] hover:scale-105"
                      }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            {/* Selected date preview */}
            {tempDate && (
              <div className="mt-3 pt-2 border-t border-[var(--border)] text-center text-xs font-medium text-[var(--muted-foreground)]">
                Selected: <span className="text-[var(--foreground)] font-bold">{formatDisplay(tempDate)}</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-3 flex justify-end gap-2 border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-full px-3 py-1.5 text-xs font-bold text-[var(--muted-foreground)] hover:bg-[var(--accent)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleApply();
                }}
                disabled={!tempDate}
                className="rounded-full bg-[var(--foreground)] px-5 py-1.5 text-xs font-bold text-[var(--background)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
              >
                Apply
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
