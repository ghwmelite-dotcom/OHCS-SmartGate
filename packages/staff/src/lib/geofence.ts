// Mirrors the server polygon in packages/api/src/routes/clock.ts so the staff
// app can fail fast (and give a meaningful error) before opening the camera.
// The server is still the source of truth — this is a UX gate, not a security
// boundary. Keep these two definitions in sync.

export type LatLng = readonly [number, number];

export const OHCS_POLYGON: readonly LatLng[] = [
  [5.552442263884538, -0.1977421643383777],
  [5.552519712150007, -0.19777261304724877],
  [5.552735220313383, -0.1971196574014586],
  [5.552656649637954, -0.19709146415250392],
];

export function pointInPolygon(lat: number, lng: number, poly: readonly LatLng[] = OHCS_POLYGON): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i] as LatLng;
    const [yj, xj] = poly[j] as LatLng;
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToSegmentMeters(
  lat: number, lng: number,
  latA: number, lngA: number,
  latB: number, lngB: number,
): number {
  const R = 6371000;
  const cosLat = Math.cos(((latA + latB) / 2) * Math.PI / 180);
  const x = (lng - lngA) * cosLat;
  const y = lat - latA;
  const dx = (lngB - lngA) * cosLat;
  const dy = latB - latA;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (x * dx + y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = dx * t - x;
  const py = dy * t - y;
  return Math.sqrt(px * px + py * py) * (Math.PI / 180) * R;
}

export function distanceToPolygonMeters(lat: number, lng: number, poly: readonly LatLng[] = OHCS_POLYGON): number {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as LatLng;
    const b = poly[j] as LatLng;
    const d = distanceToSegmentMeters(lat, lng, a[0], a[1], b[0], b[1]);
    if (d < min) min = d;
  }
  return min;
}

// Mirrors server: inside polygon AND accuracy gate met.
export const MAX_GPS_ACCURACY_METERS = 30;
