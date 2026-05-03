import { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight, Loader2, MapPin } from "lucide-react";
import { getMapEntityRollup, type MapEntityRollup } from "@/lib/api";

interface Props {
  entityId: string | null;
  onClose: () => void;
}

export function SideSheet({ entityId, onClose }: Props) {
  const [rollup, setRollup] = useState<MapEntityRollup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityId) {
      setRollup(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setRollup(null);
    getMapEntityRollup(entityId)
      .then((r) => {
        if (alive) setRollup(r);
      })
      .catch((e: unknown) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entityId]);

  return (
    <AnimatePresence>
      {entityId && (
        <motion.aside
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: "spring", stiffness: 280, damping: 32 }}
          className="absolute top-0 right-0 h-full w-[360px] max-w-[85vw] bg-bg-elevated/95 backdrop-blur-xl border-l border-border-strong z-20 flex flex-col"
        >
          <header className="flex items-center justify-between p-4 border-b border-border">
            <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
              Pin detail
            </div>
            <button
              onClick={onClose}
              className="rounded-base border border-border p-1 text-fg-muted hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="flex-1 overflow-auto p-5">
            {loading && (
              <div className="flex items-center text-fg-muted text-sm">
                <Loader2 className="size-4 animate-spin mr-2" /> Loading…
              </div>
            )}
            {error && (
              <div className="text-violation text-sm">
                {error}
              </div>
            )}
            {rollup && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                  {rollup.kind.replace("_", " ")}
                </div>
                <h2 className="font-display text-xl text-fg leading-tight mt-1">
                  {rollup.displayName}
                </h2>
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <Stat label="Pins on map" value={rollup.pinCount} />
                  <Stat label="Lexor cases" value={rollup.caseCount} />
                </div>
                {rollup.jurisdictions.length > 0 && (
                  <div className="mt-5">
                    <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-1.5">
                      Jurisdictions
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {rollup.jurisdictions.map((j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 rounded-base border border-border px-2 py-0.5 text-[11px] text-fg-muted"
                        >
                          <MapPin className="size-3" />
                          {j}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {rollup.topVertical && (
                  <div className="mt-5 text-sm text-fg-muted">
                    Most-reported issue:{" "}
                    <span className="text-fg capitalize">
                      {rollup.topVertical}
                    </span>
                  </div>
                )}
                <Link
                  href={`/entity/${rollup.id}`}
                  className="mt-6 inline-flex items-center gap-1.5 rounded-base bg-accent text-bg px-3.5 py-2 text-sm font-medium hover:opacity-90"
                >
                  Open full dossier <ArrowRight className="size-3.5" />
                </Link>
                <p className="mt-5 text-[11px] text-fg-subtle leading-relaxed">
                  Pin counts include only cases where this party was confirmed
                  as the adversary. Locations are coarsened to ~10km cells.
                </p>
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-base border border-border bg-bg/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      <div className="font-display text-xl text-fg tabular-nums mt-1">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
