// Mirrors the server polygon in packages/api/src/routes/clock.ts so the staff
// app can fail fast (and give a meaningful error) before opening the camera.
// The server is still the source of truth — this is a UX gate, not a security
// boundary. Keep these two definitions in sync.

export type LatLng = readonly [number, number];

export const OHCS_POLYGON: readonly LatLng[] = [
  [5.552642231596962, -0.19766533600075373],
  [5.55270572629351, -0.19769244846778028],
  [5.552780332553211, -0.19748033328457254],
  [5.552717631548359, -0.19743727230753033],
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

// Mirrors server: inside polygon (or within wall buffer) AND accuracy gate met.
export const MAX_GPS_ACCURACY_METERS = 30;
export const WALL_BUFFER_METERS = 20;

export function withinGeofence(lat: number, lng: number): boolean {
  if (pointInPolygon(lat, lng)) return true;
  return distanceToPolygonMeters(lat, lng) <= WALL_BUFFER_METERS;
}
