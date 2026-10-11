// -----------------------------------------------------------------------------
// User-facing texts computed at runtime (French and English). Static texts
// live in the manifest; widget texts are multi-language objects picked by the
// core, except where a value is formatted into them.
// -----------------------------------------------------------------------------

import { INDEX_KINDS } from './feelsLike.js';

export const INDEX_NAMES = {
  [INDEX_KINDS.HUMIDEX]: { en: 'Humidex', fr: 'Humidex' },
  [INDEX_KINDS.WIND_CHILL]: { en: 'Wind chill', fr: 'Refroidissement éolien' },
  [INDEX_KINDS.NONE]: { en: 'Feels like', fr: 'Ressenti' },
};

// Short forms for the 24-character tile labels.
export const INDEX_SHORT_NAMES = {
  [INDEX_KINDS.HUMIDEX]: { en: 'Humidex', fr: 'Humidex' },
  [INDEX_KINDS.WIND_CHILL]: { en: 'Wind chill', fr: 'Refroid. éolien' },
  [INDEX_KINDS.NONE]: { en: 'Feels like', fr: 'Ressenti' },
};

export const MUGGY_LABELS = {
  none: { en: 'No', fr: 'Non' },
  muggy: { en: 'Muggy', fr: 'Lourde' },
  oppressive: { en: 'Oppressive', fr: 'Étouffante' },
};

export const ICE_LABELS = {
  none: { en: 'Low', fr: 'Faible' },
  possible: { en: 'Possible', fr: 'Possible' },
  likely: { en: 'Likely', fr: 'Probable' },
};

export const PRESSURE_LABELS = {
  rising: { en: 'Rising', fr: 'En hausse' },
  steady: { en: 'Steady', fr: 'Stable' },
  falling: { en: 'Falling', fr: 'En baisse' },
  falling_fast: { en: 'Falling fast', fr: 'Chute rapide' },
};

/** "−12" with a real minus sign, as the weather sites print it. */
export function signed(value) {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

/** Local "HH:MM" of an instant, given the UTC offset of the place. */
export function localClock(instant, utcOffsetMinutes = 0) {
  return new Date(Date.parse(instant) + utcOffsetMinutes * 60_000).toISOString().slice(11, 16);
}

/** Readable one-line summary of an index and its level. */
export function describeIndex(index, level, lang, unit = '') {
  const name = INDEX_NAMES[index.kind][lang];
  const separator = lang === 'fr' ? ' : ' : ': ';
  const suffix = index.kind === INDEX_KINDS.HUMIDEX ? '' : unit;
  return `${name} ${signed(index.value)}${suffix}${separator}${level.label[lang].toLowerCase()}`;
}
