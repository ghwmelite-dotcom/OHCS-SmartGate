// Mirrors the server polygons in packages/api/src/routes/clock.ts so the
// staff app can fail fast (and give a meaningful error) before opening the
// camera. The server is still the source of truth — this is a UX gate, not
// a security boundary. Keep these definitions in sync.

export type LatLng = readonly [number, number];

export const OHCS_POLYGONS: readonly (readonly LatLng[])[] = [
  // Building 1 (~15m x 28m)
  [
    [5.552642231596962, -0.19766533600075373],
    [5.55270572629351, -0.19769244846778028],
    [5.552780332553211, -0.19748033328457254],
    [5.552717631548359, -0.19743727230753033],
  ],
  // Building 2 (~16m x 27m)
  [
    [5.552807794779271, -0.1974000832414714],
    [5.552879226292339, -0.19716723499524333],
    [5.552814144247448, -0.19715288133622927],
    [5.55273636325754, -0.19739370383746516],
  ],
  // Building 3 (~33m x 74m — the main block)
  [
    [5.552437120671583, -0.19774728898780675],
    [5.552518292169384, -0.19777004828570785],
    [5.552737266386741, -0.19712520151184268],
    [5.5526598703364645, -0.1970986489976247],
  ],
];

function pointInPolygon(lat: number, lng: number, poly: readonly LatLng[]): boolean {
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

function distanceToPolygonMetersOne(lat: number, lng: number, poly: readonly LatLng[]): number {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as LatLng;
    const b = poly[j] as LatLng;
    const d = distanceToSegmentMeters(lat, lng, a[0], a[1], b[0], b[1]);
    if (d < min) min = d;
  }
  return min;
}

export const MAX_GPS_ACCURACY_METERS = 30;
// Mirror of server WALL_BUFFER_METERS — keep in sync.
export const WALL_BUFFER_METERS = 8;

export function withinGeofence(lat: number, lng: number): boolean {
  for (const poly of OHCS_POLYGONS) {
    if (pointInPolygon(lat, lng, poly)) return true;
  }
  return distanceToPolygonMeters(lat, lng) <= WALL_BUFFER_METERS;
}

export function distanceToPolygonMeters(lat: number, lng: number): number {
  let min = Infinity;
  for (const poly of OHCS_POLYGONS) {
    const d = distanceToPolygonMetersOne(lat, lng, poly);
    if (d < min) min = d;
  }
  return min;
}
