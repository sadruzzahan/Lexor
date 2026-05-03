import { useEffect, useState } from "react";
import { useDocumentTitle } from "@/lib/hooks";
import {
  getMapMarkers,
  getMapStats,
  type MapMarkerCell,
  type MapStats,
} from "@/lib/api";
import { PredatorMap } from "@/components/map/PredatorMap";
import { FilterPanel } from "@/components/map/FilterPanel";
import { StatTicker } from "@/components/map/StatTicker";
import { Leaderboard } from "@/components/map/Leaderboard";
import { SideSheet } from "@/components/map/SideSheet";

export default function MapPage() {
  useDocumentTitle("Predator Map — Lexor");
  const [vertical, setVertical] = useState<string | null>(null);
  const [sinceDays, setSinceDays] = useState<number | null>(null);
  const [markers, setMarkers] = useState<MapMarkerCell[]>([]);
  const [stats, setStats] = useState<MapStats | null>(null);
  const [activeEntity, setActiveEntity] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getMapMarkers({ vertical, sinceDays }).then(
      (m) => alive && setMarkers(m),
    );
    return () => {
      alive = false;
    };
  }, [vertical, sinceDays]);

  useEffect(() => {
    let alive = true;
    void getMapStats().then((s) => alive && setStats(s));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] overflow-hidden">
      <PredatorMap
        markers={markers}
        onCellClick={(eid) => setActiveEntity(eid)}
      />
      {/* Vignette + scanline texture */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(11,11,20,0.85)_100%)]" />

      {/* Top bar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 w-[min(96vw,820px)] flex flex-col gap-3">
        <StatTicker stats={stats} />
        <Leaderboard stats={stats} />
      </div>

      {/* Filter panel */}
      <div className="absolute top-4 left-4 z-10 hidden md:block">
        <FilterPanel
          vertical={vertical}
          sinceDays={sinceDays}
          onVertical={setVertical}
          onSinceDays={setSinceDays}
        />
      </div>

      {/* Empty state */}
      {markers.length === 0 && stats && stats.totalMarkers === 0 && (
        <div className="absolute inset-x-0 bottom-10 mx-auto w-fit max-w-md text-center text-fg-muted bg-bg-elevated/80 backdrop-blur-md rounded-xl2 border border-border px-6 py-4 z-10">
          <div className="font-display text-fg text-lg">
            The map starts empty.
          </div>
          <p className="text-sm mt-1">
            Every letter someone uploads pins one anonymized cell here. Be the
            first.
          </p>
        </div>
      )}

      <SideSheet
        entityId={activeEntity}
        onClose={() => setActiveEntity(null)}
      />
    </div>
  );
}
