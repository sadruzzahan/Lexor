import { cn } from "@/lib/utils";

const VERTICALS = [
  { id: null, label: "All" },
  { id: "eviction", label: "Eviction", swatch: "#ff5470" },
  { id: "debt", label: "Debt", swatch: "#ffba49" },
  { id: "wage", label: "Wage theft", swatch: "#3ddbd9" },
  { id: "other", label: "Other", swatch: "#9b87ff" },
] as const;

const WINDOWS = [
  { id: 7, label: "7d" },
  { id: 30, label: "30d" },
  { id: 90, label: "90d" },
  { id: null, label: "All time" },
] as const;

const VIOLATIONS = [
  { id: null, label: "Any" },
  { id: "CA Civ Code §1946.2", label: "CA Just-Cause" },
  { id: "FDCPA §1692e", label: "FDCPA misrep." },
  { id: "FDCPA §1692g", label: "FDCPA validation" },
  { id: "FLSA §207", label: "FLSA OT" },
  { id: "TX Prop §92.0563", label: "TX Repair" },
  { id: "NY RPL §235-b", label: "NY Habitability" },
] as const;

interface Props {
  vertical: string | null;
  sinceDays: number | null;
  violation: string | null;
  onVertical: (v: string | null) => void;
  onSinceDays: (d: number | null) => void;
  onViolation: (v: string | null) => void;
}

export function FilterPanel({
  vertical,
  sinceDays,
  violation,
  onVertical,
  onSinceDays,
  onViolation,
}: Props) {
  return (
    <div className="rounded-xl2 border border-border-strong bg-bg-elevated/80 backdrop-blur-md p-4 w-72 shadow-xl">
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
        Vertical
      </div>
      <div className="flex flex-wrap gap-1.5 mb-5">
        {VERTICALS.map((v) => {
          const active = vertical === v.id;
          return (
            <button
              key={v.label}
              onClick={() => onVertical(v.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                active
                  ? "border-accent bg-accent/15 text-fg"
                  : "border-border bg-bg/40 text-fg-muted hover:text-fg",
              )}
            >
              {"swatch" in v && (
                <span
                  className="size-2 rounded-full"
                  style={{ background: v.swatch }}
                />
              )}
              {v.label}
            </button>
          );
        })}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
        Time window
      </div>
      <div className="flex gap-1.5 mb-5">
        {WINDOWS.map((w) => {
          const active = sinceDays === w.id;
          return (
            <button
              key={w.label}
              onClick={() => onSinceDays(w.id)}
              className={cn(
                "rounded-base border px-2.5 py-1 text-xs transition-colors",
                active
                  ? "border-accent bg-accent/15 text-fg"
                  : "border-border bg-bg/40 text-fg-muted hover:text-fg",
              )}
            >
              {w.label}
            </button>
          );
        })}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
        Violation
      </div>
      <div className="flex flex-wrap gap-1.5">
        {VIOLATIONS.map((v) => {
          const active = violation === v.id;
          return (
            <button
              key={v.label}
              onClick={() => onViolation(v.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                active
                  ? "border-accent bg-accent/15 text-fg"
                  : "border-border bg-bg/40 text-fg-muted hover:text-fg",
              )}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-fg-subtle">
        Pins are anonymized to a coarse grid. Cells with fewer than 3 cases are
        hidden until more people report.
      </p>
    </div>
  );
}
