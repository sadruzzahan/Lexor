import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, MapPin, ArrowRight } from "lucide-react";
import { PredatorMap } from "@/components/map/PredatorMap";
import {
  getMapMarkers,
  getMapEntityRollup,
  type MapMarkerCell,
  type MapEntityRollup,
} from "@/lib/api";

interface Props {
  entityId: string | null;
}

export function CaseMap({ entityId }: Props) {
  const [markers, setMarkers] = useState<MapMarkerCell[] | null>(null);
  const [rollup, setRollup] = useState<MapEntityRollup | null>(null);

  useEffect(() => {
    if (!entityId) return;
    let alive = true;
    void getMapMarkers({ entityId }).then((m) => alive && setMarkers(m));
    void getMapEntityRollup(entityId)
      .then((r) => alive && setRollup(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entityId]);

  if (!entityId) {
    return (
      <div className="rounded-lg2 border border-dashed border-border-strong bg-bg-elevated/40 p-10 text-center">
        <MapPin className="mx-auto size-6 text-fg-subtle mb-3" />
        <div className="font-display text-xl text-fg">No adversary yet</div>
        <p className="mt-2 text-fg-muted text-sm max-w-md mx-auto">
          The Map tab lights up once we've identified the opposing party on
          your case.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
            Predator Map · scoped to your adversary
          </div>
          <h3 className="font-display text-2xl text-fg">
            {rollup?.displayName ?? "Loading…"}
          </h3>
          {rollup && (
            <p className="text-fg-muted text-sm mt-1">
              {rollup.pinCount} pin{rollup.pinCount === 1 ? "" : "s"} ·{" "}
              {rollup.caseCount} Lexor case
              {rollup.caseCount === 1 ? "" : "s"} ·{" "}
              {rollup.jurisdictions.length} state
              {rollup.jurisdictions.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <Link
          href="/map"
          className="inline-flex items-center gap-1.5 rounded-base border border-border-strong px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
        >
          Open full Predator Map <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="relative w-full h-[480px] rounded-xl2 overflow-hidden border border-border-strong bg-bg-elevated">
        {!markers && (
          <div className="absolute inset-0 flex items-center justify-center text-fg-muted">
            <Loader2 className="animate-spin size-5 mr-2" /> Loading map…
          </div>
        )}
        {markers && markers.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-fg-muted text-center px-6">
            <MapPin className="size-6 text-fg-subtle mb-3" />
            <div className="font-display text-fg">No pins yet</div>
            <p className="text-sm mt-1 max-w-sm">
              Yours will be the first. As more people upload letters from this
              adversary, the map fills out.
            </p>
          </div>
        )}
        {markers && markers.length > 0 && <PredatorMap markers={markers} />}
      </div>
    </div>
  );
}
