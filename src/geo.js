// -----------------------------------------------------------------------------
// Small geographic helpers (pure functions).
// -----------------------------------------------------------------------------

const RAD = Math.PI / 180;

/** Great-circle distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Cache key of a location: 3 decimals (about 100 m), so the house of one
 * user always hits the same entry whatever the float noise.
 */
export function locationKey(latitude, longitude) {
  return `${Number(latitude).toFixed(3)},${Number(longitude).toFixed(3)}`;
}

export function isValidLocation(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/**
 * Rough bounding box of Canada (with its border margin): ECCC alerts, city
 * pages and radar cover nothing outside, no need to ask them.
 */
export function isInCanadaArea(latitude, longitude) {
  return latitude >= 41.5 && latitude <= 84 && longitude >= -141.5 && longitude <= -52;
}

// Ray casting on one ring of [lon, lat] points.
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(lon, lat, rings) {
  if (!Array.isArray(rings) || rings.length === 0 || !inRing(lon, lat, rings[0])) {
    return false;
  }
  // The other rings are holes.
  return !rings.slice(1).some((hole) => inRing(lon, lat, hole));
}

/** Whether a GeoJSON Polygon / MultiPolygon contains the point. */
export function geometryContains(geometry, latitude, longitude) {
  if (geometry?.type === 'Polygon') {
    return inPolygon(longitude, latitude, geometry.coordinates);
  }
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.some((rings) => inPolygon(longitude, latitude, rings));
  }
  return false;
}

/** Web Mercator (EPSG:3857) bounding box centered on a point. */
export function mercatorBbox(latitude, longitude, halfWidthKm, halfHeightKm) {
  const x = (longitude * 20037508.34) / 180;
  const y = Math.log(Math.tan(((90 + latitude) * Math.PI) / 360)) * 6378137;
  // Mercator stretches distances by 1/cos(latitude).
  const scale = 1000 / Math.cos(latitude * RAD);
  return [
    x - halfWidthKm * scale,
    y - halfHeightKm * scale,
    x + halfWidthKm * scale,
    y + halfHeightKm * scale,
  ].map((v) => Math.round(v));
}
