"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function Navbar() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-8">

        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--foreground)] text-[var(--background)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight text-[var(--foreground)]">
            airrive<span style={{ color: "var(--cyan)" }}>.</span><span style={{ color: "var(--cyan)" }}>AI</span>
          </span>
        </div>

        {/* Theme toggle */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
            aria-label="Toggle theme"
          >
            {mounted && theme === "dark" ? (
              <Moon className="h-4 w-4" />
            ) : mounted && theme === "light" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Monitor className="h-4 w-4" />
            )}
          </button>

          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
              <div className="absolute right-0 top-11 z-50 mt-1 w-36 rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg">
                {[
                  { label: "Light", value: "light", icon: <Sun className="h-4 w-4" /> },
                  { label: "Dark", value: "dark", icon: <Moon className="h-4 w-4" /> },
                  { label: "System", value: "system", icon: <Monitor className="h-4 w-4" /> },
                ].map(({ label, value, icon }) => (
                  <button
                    key={value}
                    onClick={() => { setTheme(value); setDropdownOpen(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--card-foreground)] hover:bg-[var(--accent)] ${theme === value ? "bg-[var(--accent)] font-semibold" : ""}`}
                  >
                    {icon}{label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
