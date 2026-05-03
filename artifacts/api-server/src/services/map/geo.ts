/**
 * Geocoding helpers for the Predator Map.
 *
 * We do NOT do real address geocoding here. The product's anonymization
 * promise is "no marker resolves to a single building", so even if we had
 * a precise address we would deliberately discard precision. Instead:
 *
 *   1. Project a case's `jurisdiction` (e.g. "US-CA") to the state's
 *      population-weighted centroid.
 *   2. Add deterministic jitter keyed by caseId so the same case always
 *      lands in the same spot but the cloud spreads out across a state.
 *   3. Round to `CELL_DEG` so cells are addressable for k-anonymity
 *      suppression.
 *
 * When we add real ZIP-level geocoding, the public surface (return shape +
 * cell rounding + jitter envelope) stays identical so callers don't change.
 */

const STATE_CENTROIDS: Record<string, [number, number]> = {
  // [lat, lng], population-weighted approximations.
  "US-AL": [32.806, -86.791],
  "US-AK": [61.370, -152.404],
  "US-AZ": [33.729, -111.431],
  "US-AR": [34.969, -92.373],
  "US-CA": [36.116, -119.682],
  "US-CO": [39.059, -105.311],
  "US-CT": [41.597, -72.755],
  "US-DE": [39.318, -75.507],
  "US-FL": [27.766, -81.686],
  "US-GA": [33.040, -83.643],
  "US-HI": [21.094, -157.498],
  "US-ID": [44.240, -114.479],
  "US-IL": [40.349, -88.986],
  "US-IN": [39.849, -86.258],
  "US-IA": [42.011, -93.210],
  "US-KS": [38.526, -96.726],
  "US-KY": [37.668, -84.670],
  "US-LA": [31.169, -91.867],
  "US-ME": [44.693, -69.381],
  "US-MD": [39.063, -76.802],
  "US-MA": [42.230, -71.530],
  "US-MI": [43.326, -84.536],
  "US-MN": [45.694, -93.900],
  "US-MS": [32.741, -89.678],
  "US-MO": [38.456, -92.288],
  "US-MT": [46.921, -110.454],
  "US-NE": [41.125, -98.268],
  "US-NV": [38.313, -117.055],
  "US-NH": [43.452, -71.563],
  "US-NJ": [40.298, -74.521],
  "US-NM": [34.840, -106.248],
  "US-NY": [42.165, -74.948],
  "US-NC": [35.630, -79.806],
  "US-ND": [47.529, -99.784],
  "US-OH": [40.388, -82.764],
  "US-OK": [35.565, -96.928],
  "US-OR": [44.572, -122.070],
  "US-PA": [40.590, -77.209],
  "US-RI": [41.680, -71.511],
  "US-SC": [33.856, -80.945],
  "US-SD": [44.299, -99.439],
  "US-TN": [35.747, -86.692],
  "US-TX": [31.054, -97.563],
  "US-UT": [40.150, -111.862],
  "US-VT": [44.045, -72.710],
  "US-VA": [37.769, -78.170],
  "US-WA": [47.400, -121.490],
  "US-WV": [38.491, -80.954],
  "US-WI": [44.268, -89.616],
  "US-WY": [42.756, -107.302],
  "US-DC": [38.897, -77.026],
};

/**
 * Coarse-grain cell size in degrees (≈111km at the equator — roughly a
 * metro region). Sized larger than the per-state JITTER envelope so that
 * a single state contributes to only a handful of cells, helping each
 * cell clear the k-anonymity threshold while remaining too coarse to
 * resolve to a neighborhood.
 */
export const CELL_DEG = 1.0;

/** Per-state jitter envelope in degrees. Approx ±150km at most US states. */
const JITTER_DEG = 1.5;

/**
 * djb2-ish hash → uniform [0, 1).
 */
function hash01(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h) ^ seed.charCodeAt(i);
  }
  // unsigned 32-bit
  return ((h >>> 0) % 100000) / 100000;
}

/** Centroid for a US-XX jurisdiction or null if unknown. */
export function centroidFor(jurisdiction: string | null): [number, number] | null {
  if (!jurisdiction) return null;
  const c = STATE_CENTROIDS[jurisdiction.toUpperCase()];
  return c ?? null;
}

/** Round to the public cell grid. */
export function snapToCell(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Math.round(lat / CELL_DEG) * CELL_DEG,
    lng: Math.round(lng / CELL_DEG) * CELL_DEG,
  };
}

/**
 * Resolve a case to coarse map coordinates. Returns null if we can't
 * place the case on the US map at all (no jurisdiction). The returned
 * coords are NOT yet snapped to the public cell — that snap happens at
 * read time so we can re-bucket without rewriting rows.
 */
export function placeCase(opts: {
  caseId: string;
  jurisdiction: string | null;
}): { lat: number; lng: number } | null {
  const c = centroidFor(opts.jurisdiction);
  if (!c) return null;
  const [baseLat, baseLng] = c;
  const jLat = (hash01(`${opts.caseId}:lat`) - 0.5) * 2 * JITTER_DEG;
  const jLng = (hash01(`${opts.caseId}:lng`) - 0.5) * 2 * JITTER_DEG;
  return { lat: baseLat + jLat, lng: baseLng + jLng };
}
