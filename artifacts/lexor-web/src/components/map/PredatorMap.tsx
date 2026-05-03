import { useMemo, useRef } from "react";
import Map, {
  NavigationControl,
  Source,
  Layer,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapMarkerCell } from "@/lib/api";

interface Props {
  markers: MapMarkerCell[];
  /** When set, the map is constrained to this entity's footprint (case page). */
  focusEntityId?: string | null;
  onCellClick?: (entityId: string | null) => void;
}

const STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const VERTICAL_COLORS: Record<string, string> = {
  eviction: "#ff5470",
  debt: "#ffba49",
  wage: "#3ddbd9",
  other: "#9b87ff",
};

export function PredatorMap({ markers, onCellClick }: Props) {
  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: markers.map((m) => ({
        type: "Feature" as const,
        properties: {
          id: m.id,
          entityId: m.entityId,
          vertical: m.caseVertical,
          count: m.count,
          color: VERTICAL_COLORS[m.caseVertical] ?? VERTICAL_COLORS.other,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [m.coarseLng, m.coarseLat],
        },
      })),
    }),
    [markers],
  );

  const mapRef = useRef<MapRef | null>(null);

  const handleClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const eid = (f.properties?.entityId ?? null) as string | null;
    // Zoom toward the clicked cell so dense regions can be inspected
    // without server-side re-clustering (markers are already aggregated
    // server-side per cell, so we don't need a cluster source).
    const map = mapRef.current?.getMap();
    if (map) {
      const geom = f.geometry as unknown as {
        type: string;
        coordinates: [number, number];
      };
      if (geom.type !== "Point") return;
      const [lng, lat] = geom.coordinates;
      const current = map.getZoom();
      map.easeTo({
        center: [lng, lat],
        zoom: Math.min(7.5, Math.max(current + 1.5, 5)),
        duration: 600,
      });
    }
    onCellClick?.(eid);
  };

  return (
    <Map
      ref={mapRef}
      mapStyle={STYLE_URL}
      initialViewState={{ longitude: -96, latitude: 39, zoom: 3.4 }}
      maxZoom={9}
      minZoom={2.5}
      attributionControl={{ compact: true }}
      style={{ width: "100%", height: "100%" }}
      interactiveLayerIds={["pin-points"]}
      onClick={handleClick}
      onMouseEnter={(e) => {
        const map = mapRef.current?.getMap();
        if (map && e.features && e.features.length > 0) {
          map.getCanvas().style.cursor = "pointer";
        }
      }}
      onMouseLeave={() => {
        const map = mapRef.current?.getMap();
        if (map) map.getCanvas().style.cursor = "";
      }}
      cursor="default"
    >
      <NavigationControl position="bottom-right" showCompass={false} />
      <Source id="pins" type="geojson" data={geojson}>
        <Layer
          id="pin-heat"
          type="heatmap"
          maxzoom={6}
          paint={{
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["get", "count"],
              0,
              0,
              50,
              1,
            ],
            "heatmap-intensity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              0.4,
              6,
              2.4,
            ],
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(0,0,0,0)",
              0.2,
              "rgba(155,135,255,0.35)",
              0.5,
              "rgba(255,186,73,0.55)",
              0.85,
              "rgba(255,84,112,0.85)",
            ],
            "heatmap-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              4,
              6,
              28,
            ],
            "heatmap-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              4,
              0.9,
              7,
              0.2,
            ],
          }}
        />
        <Layer
          id="pin-points"
          type="circle"
          minzoom={4}
          paint={{
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["get", "count"],
              1,
              4,
              10,
              8,
              50,
              16,
              200,
              26,
            ],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.78,
            "circle-stroke-color": "#0b0b14",
            "circle-stroke-width": 1,
          }}
        />
      </Source>
    </Map>
  );
}
