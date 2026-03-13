export function SkeletonLoader() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex h-[120px] w-full animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6"
        >
          <div className="flex w-1/4 items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-[var(--muted)]" />
            <div className="space-y-2">
              <div className="h-4 w-24 rounded-lg bg-[var(--muted)]" />
              <div className="h-3 w-16 rounded-lg bg-[var(--muted)]" />
            </div>
          </div>
          <div className="flex w-2/4 flex-col justify-center px-4">
            <div className="h-1.5 w-full rounded-full bg-[var(--border)]" />
          </div>
          <div className="flex w-1/4 flex-col items-end justify-center gap-2">
            <div className="h-6 w-20 rounded-lg bg-[var(--muted)]" />
            <div className="h-9 w-full rounded-full bg-[var(--muted)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AiSkeletonLoader() {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
      {/* Animated cyan top bar */}
      <div className="h-1 w-full relative overflow-hidden bg-[var(--muted)]">
        <div
          className="absolute inset-y-0 w-1/3"
          style={{
            background: "linear-gradient(to right, transparent, var(--cyan), transparent)",
            animation: "shimmer 1.8s infinite",
          }}
        />
      </div>

      <div className="px-7 pt-6 pb-2 flex items-center gap-3">
        <div className="h-5 w-5 rounded-full bg-[var(--muted)] animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-4 w-52 rounded-lg bg-[var(--muted)] animate-pulse" />
          <div className="h-3 w-36 rounded-lg bg-[var(--muted)] animate-pulse" />
        </div>
      </div>

      <div className="mx-7 mt-4 mb-6 h-px bg-[var(--border)]" />

      {/* Paragraph skeletons */}
      <div className="px-7 pb-7 space-y-6">
        {[
          ["w-full", "w-full", "w-4/5"],
          ["w-full", "w-full", "w-3/4"],
          ["w-full", "w-5/6", "w-full", "w-2/3"],
          ["w-full", "w-full", "w-4/5"],
        ].map((lines, pi) => (
          <div key={pi} className="space-y-2.5">
            {lines.map((w, li) => (
              <div
                key={li}
                className={`h-4 rounded-lg bg-[var(--muted)] animate-pulse ${w}`}
                style={{ animationDelay: `${(pi * lines.length + li) * 80}ms` }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className="px-7 pb-6">
        <div className="flex items-center gap-2.5">
          <div className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: "var(--cyan)" }} />
          <p className="text-xs text-[var(--muted-foreground)] animate-pulse">
            Analysing pricing, reliability, and route data...
          </p>
        </div>
      </div>
    </div>
  );
}
