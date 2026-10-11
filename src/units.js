// -----------------------------------------------------------------------------
// Unit conversions (pure functions).
//
// Internally everything is kept in the pivot METRIC system: °C, m/s, hPa, mm,
// km. The sources give km/h and kPa; the "us" pivot wants °F, mph, in, mi.
// -----------------------------------------------------------------------------

export const kmhToMs = (kmh) => kmh / 3.6;
export const msToKmh = (ms) => ms * 3.6;
export const msToMph = (ms) => ms * 2.2369362920544;
export const kpaToHpa = (kpa) => kpa * 10;
export const celsiusToFahrenheit = (c) => (c * 9) / 5 + 32;
export const mmToInches = (mm) => mm / 25.4;
export const kmToMiles = (km) => km / 1.609344;

/** Round to `digits` decimals, keeping null/undefined as-is. */
export function round(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** A finite number or undefined (never NaN, never null). */
export function num(value) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// 16-point compass, as ECCC writes it (EN and FR spellings).
const COMPASS = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

/** Compass point (N, SW, OSO...) to degrees; undefined for "VR" (variable). */
export function compassToDegrees(point) {
  if (typeof point !== 'string') {
    return undefined;
  }
  const normalized = point.trim().toUpperCase().replaceAll('O', 'W');
  return COMPASS[normalized];
}
