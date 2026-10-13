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

// --- Alerts: levels, kinds, local times -------------------------------------

// The four CAP severities, with 0 for "no alert".
export const LEVEL_NAMES = {
  en: ['No alert', 'Minor', 'Moderate', 'Severe', 'Extreme'],
  fr: ['Aucune alerte', 'Mineure', 'Modérée', 'Sévère', 'Extrême'],
};

export const KIND_NAMES = {
  en: {
    wind: 'Wind',
    rain: 'Rain',
    flood: 'Flood',
    thunderstorm: 'Thunderstorms',
    snow: 'Snow and freezing rain',
    heat: 'Heat',
    cold: 'Cold',
    avalanche: 'Avalanche',
    coastal: 'Coastal',
    fog: 'Fog',
    other: 'Other',
  },
  fr: {
    wind: 'Vent',
    rain: 'Pluie',
    flood: 'Inondation',
    thunderstorm: 'Orages',
    snow: 'Neige et pluie verglaçante',
    heat: 'Chaleur',
    cold: 'Froid',
    avalanche: 'Avalanche',
    coastal: 'Côtier',
    fog: 'Brouillard',
    other: 'Autre',
  },
};

export const WORDS = {
  en: {
    now: 'Now',
    later: 'Later',
    none: 'None',
    tomorrow: 'tomorrow',
    until: (t) => `until ${t}`,
    from: (t) => `from ${t}`,
    inForce: 'in force',
    watch: 'Watch',
    level: (n) => `Level ${n}`,
  },
  fr: {
    now: 'Maintenant',
    later: 'À venir',
    none: 'Aucune',
    tomorrow: 'demain',
    until: (t) => `jusqu’à ${t}`,
    from: (t) => `à partir de ${t}`,
    inForce: 'en cours',
    watch: 'Veille',
    level: (n) => `Niveau ${n}`,
  },
};

/** Language of the texts we hold (French or English). */
export function textLanguage(language) {
  return typeof language === 'string' && language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const formatters = new Map();
function formatter(key, make) {
  if (!formatters.has(key)) {
    formatters.set(key, make());
  }
  return formatters.get(key);
}

const LOCALES = { en: 'en-CA', fr: 'fr-CA' };

export function localDateIn(ms, timeZone) {
  return formatter(
    `date:${timeZone}`,
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
  ).format(ms);
}

export function clock(ms, timeZone) {
  return formatter(
    `clock:${timeZone}`,
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
  ).format(ms);
}

/**
 * An instant as a person says it: "14:00" today, "tomorrow 06:00", "Thu
 * 15/10 14:00" further away.
 * @param {number} ms
 * @param {{ now: number, timeZone: string, language: string }} context
 */
export function when(ms, { now, timeZone, language }) {
  const day = localDateIn(ms, timeZone);
  const time = clock(ms, timeZone);
  const today = localDateIn(now, timeZone);
  if (day === today) {
    return time;
  }
  // The calendar day after today, whatever the length of today (23 or 25 h).
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (tomorrow.toISOString().slice(0, 10) === day) {
    return `${WORDS[language].tomorrow} ${time}`;
  }
  const date = formatter(
    `day:${language}:${timeZone}`,
    () =>
      new Intl.DateTimeFormat(LOCALES[language], {
        timeZone,
        weekday: 'short',
        day: 'numeric',
        month: 'numeric',
      }),
  ).format(ms);
  return `${date} ${time}`;
}

/** "until 22:00", "from tomorrow 06:00", "14:00 – 22:00". */
export function period(alert, active, context) {
  const words = WORDS[context.language];
  const { onsetMs: onset, expiresMs: expires } = alert;
  if (active) {
    return expires === undefined ? words.inForce : words.until(when(expires, context));
  }
  if (onset === undefined) {
    return expires === undefined ? '' : words.until(when(expires, context));
  }
  if (expires === undefined) {
    return words.from(when(onset, context));
  }
  const sameDay = localDateIn(onset, context.timeZone) === localDateIn(expires, context.timeZone);
  const end = sameDay ? clock(expires, context.timeZone) : when(expires, context);
  return `${when(onset, context)} – ${end}`;
}

/** The title of an alert: its ECCC name, with its level in brackets. */
export function alertTitle(alert, language) {
  const name = alert.event?.[language] ?? alert.event?.en ?? '';
  return `${name} (${WORDS[language].level(alert.level).toLowerCase()})`;
}
