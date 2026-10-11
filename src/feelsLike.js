// -----------------------------------------------------------------------------
// Feels-like indices of Environment and Climate Change Canada (pure functions).
//
//   - humidex: summer, air temperature + dew point;
//   - wind chill: winter, air temperature + wind speed (JAG/TI 2001 formula,
//     the one ECCC has published since 2001).
//
// Both are rounded to the unit like ECCC does before reading its risk scales.
// The scene trigger engine of Gladys compares exact values (no thresholds),
// so the indices are turned into DISCRETE levels below.
// -----------------------------------------------------------------------------

/** Humidex from the air temperature and the dew point (°C). */
export function humidex(temperature, dewPoint) {
  if (!Number.isFinite(temperature) || !Number.isFinite(dewPoint)) {
    return undefined;
  }
  const e = 6.11 * Math.exp(5417.753 * (1 / 273.16 - 1 / (273.15 + dewPoint)));
  return temperature + 0.5555 * (e - 10);
}

/**
 * Wind chill from the air temperature (°C) and the wind speed (km/h, at 10 m).
 * Defined for temperatures of 10 °C or less. Under 5 km/h ECCC uses its
 * low-wind approximation, so the index never jumps at 5 km/h.
 */
export function windChill(temperature, windKmh) {
  if (!Number.isFinite(temperature) || !Number.isFinite(windKmh) || temperature > 10) {
    return undefined;
  }
  const v = Math.max(0, windKmh);
  if (v < 5) {
    return temperature + ((-1.59 + 0.1345 * temperature) / 5) * v;
  }
  const v016 = v ** 0.16;
  return 13.12 + 0.6215 * temperature - 11.37 * v016 + 0.3965 * temperature * v016;
}

/** Dew point (°C) from the temperature and the relative humidity (Magnus). */
export function dewPointFromHumidity(temperature, humidity) {
  if (!Number.isFinite(temperature) || !Number.isFinite(humidity) || humidity <= 0) {
    return undefined;
  }
  const a = 17.625;
  const b = 243.04;
  const gamma = Math.log(Math.min(humidity, 100) / 100) + (a * temperature) / (b + temperature);
  return (b * gamma) / (a - gamma);
}

export const INDEX_KINDS = { HUMIDEX: 'humidex', WIND_CHILL: 'wind_chill', NONE: 'none' };

// Humidex is only meaningful in the heat, wind chill only in the cold.
const HUMIDEX_MIN_TEMPERATURE = 20;

/**
 * The index that applies to a set of conditions, rounded like ECCC does.
 * @param {{ temperature: number, dew_point?: number, humidity?: number, wind_kmh?: number }} c
 * @returns {{ kind: string, value: number }}
 */
export function feelsLikeIndex({ temperature, dew_point: dewPoint, humidity, wind_kmh: windKmh }) {
  if (!Number.isFinite(temperature)) {
    return undefined;
  }
  if (temperature >= HUMIDEX_MIN_TEMPERATURE) {
    const td = Number.isFinite(dewPoint) ? dewPoint : dewPointFromHumidity(temperature, humidity);
    const h = humidex(temperature, td);
    if (h !== undefined) {
      return { kind: INDEX_KINDS.HUMIDEX, value: Math.round(h) };
    }
  }
  const w = windChill(temperature, windKmh);
  if (w !== undefined) {
    return { kind: INDEX_KINDS.WIND_CHILL, value: Math.round(w) };
  }
  return { kind: INDEX_KINDS.NONE, value: Math.round(temperature) };
}

// -----------------------------------------------------------------------------
// Risk levels. `rank` orders them on one axis (cold < 0 < heat), so a level
// change is a walk along that axis; `|rank|` is the severity.
// -----------------------------------------------------------------------------

export const LEVELS = [
  {
    key: 'cold_extreme',
    rank: -5,
    // ≤ -55: exposed skin freezes in less than 2 minutes.
    test: (kind, v) => kind === INDEX_KINDS.WIND_CHILL && v <= -55,
    label: { en: 'Extreme cold risk', fr: 'Risque extrême (froid)' },
    frostbite: { en: 'Under 2 min', fr: 'Moins de 2 min' },
    advice: {
      en: 'Exposed skin freezes in less than 2 minutes. Stay indoors.',
      fr: 'La peau exposée gèle en moins de 2 minutes. Restez à l’intérieur.',
    },
  },
  {
    key: 'cold_severe',
    rank: -4,
    test: (kind, v) => kind === INDEX_KINDS.WIND_CHILL && v <= -48,
    label: { en: 'Severe cold risk', fr: 'Risque grave (froid)' },
    frostbite: { en: '2 to 5 min', fr: '2 à 5 min' },
    advice: {
      en: 'Exposed skin can freeze in 2 to 5 minutes. Cover all skin.',
      fr: 'La peau exposée peut geler en 2 à 5 minutes. Couvrez toute la peau.',
    },
  },
  {
    key: 'cold_very_high',
    rank: -3,
    test: (kind, v) => kind === INDEX_KINDS.WIND_CHILL && v <= -40,
    label: { en: 'Very high cold risk', fr: 'Risque très élevé (froid)' },
    frostbite: { en: '5 to 10 min', fr: '5 à 10 min' },
    advice: {
      en: 'Exposed skin can freeze in 5 to 10 minutes. Limit time outdoors.',
      fr: 'La peau exposée peut geler en 5 à 10 minutes. Limitez le temps dehors.',
    },
  },
  {
    key: 'cold_high',
    rank: -2,
    test: (kind, v) => kind === INDEX_KINDS.WIND_CHILL && v <= -28,
    label: { en: 'High cold risk', fr: 'Risque élevé (froid)' },
    frostbite: { en: '10 to 30 min', fr: '10 à 30 min' },
    advice: {
      en: 'Exposed skin can freeze in 10 to 30 minutes. Dress in layers.',
      fr: 'La peau exposée peut geler en 10 à 30 minutes. Habillez-vous en couches.',
    },
  },
  {
    key: 'cold_moderate',
    rank: -1,
    test: (kind, v) => kind === INDEX_KINDS.WIND_CHILL && v <= -10,
    label: { en: 'Moderate cold risk', fr: 'Risque modéré (froid)' },
    frostbite: { en: 'Low risk', fr: 'Risque faible' },
    advice: {
      en: 'Uncomfortable. Dress warmly, keep dry.',
      fr: 'Inconfortable. Habillez-vous chaudement, restez au sec.',
    },
  },
  {
    key: 'comfortable',
    rank: 0,
    test: () => true,
    label: { en: 'Low risk', fr: 'Risque faible' },
    advice: { en: 'No particular risk.', fr: 'Aucun risque particulier.' },
  },
  {
    key: 'heat_discomfort',
    rank: 1,
    test: (kind, v) => kind === INDEX_KINDS.HUMIDEX && v >= 30,
    label: { en: 'Some discomfort', fr: 'Inconfort' },
    advice: {
      en: 'Some discomfort. Drink water, seek shade.',
      fr: 'Un certain inconfort. Buvez de l’eau, cherchez l’ombre.',
    },
  },
  {
    key: 'heat_great_discomfort',
    rank: 2,
    test: (kind, v) => kind === INDEX_KINDS.HUMIDEX && v >= 40,
    label: { en: 'Great discomfort', fr: 'Grand inconfort' },
    advice: {
      en: 'Great discomfort: avoid exertion.',
      fr: 'Grand inconfort : évitez les efforts.',
    },
  },
  {
    key: 'heat_danger',
    rank: 3,
    test: (kind, v) => kind === INDEX_KINDS.HUMIDEX && v >= 46,
    label: { en: 'Dangerous heat', fr: 'Chaleur dangereuse' },
    advice: {
      en: 'Dangerous: stop physical activity, stay cool.',
      fr: 'Dangereux : cessez toute activité physique, restez au frais.',
    },
  },
  {
    key: 'heat_stroke',
    rank: 4,
    test: (kind, v) => kind === INDEX_KINDS.HUMIDEX && v >= 54,
    label: { en: 'Heat stroke imminent', fr: 'Coup de chaleur imminent' },
    advice: {
      en: 'Heat stroke imminent. Seek a cool place now.',
      fr: 'Coup de chaleur imminent. Mettez-vous au frais immédiatement.',
    },
  },
];

const LEVELS_BY_KEY = Object.fromEntries(LEVELS.map((level) => [level.key, level]));
export const LEVEL_KEYS = LEVELS.map((level) => level.key);
export const COMFORTABLE = 'comfortable';

export function getLevel(key) {
  return LEVELS_BY_KEY[key];
}

// Most severe first, so the first match wins.
const BY_SEVERITY = [...LEVELS].sort((a, b) => Math.abs(b.rank) - Math.abs(a.rank));

/** Level of an index ({ kind, value }). */
export function levelOf(index) {
  if (!index) {
    return COMFORTABLE;
  }
  return BY_SEVERITY.find((level) => level.test(index.kind, index.value)).key;
}

// One unit of margin before a level is LEFT (never before it is entered):
// an index hovering on a threshold must not fire a scene every 5 minutes.
const HYSTERESIS = 1;

/**
 * Level of an index, given the previous level: a less severe level is only
 * adopted once the index clears the threshold by HYSTERESIS.
 */
export function levelWithHysteresis(index, previousKey) {
  const candidate = levelOf(index);
  const previous = getLevel(previousKey);
  if (!index || !previous || candidate === previousKey) {
    return candidate;
  }
  const candidateRank = getLevel(candidate).rank;
  // Same side of comfortable (or back to it), closer to it.
  const lessSevere =
    Math.abs(candidateRank) < Math.abs(previous.rank) &&
    (candidateRank === 0 || Math.sign(candidateRank) === Math.sign(previous.rank));
  if (!lessSevere) {
    return candidate;
  }
  // Push the value back toward the previous level by the margin.
  const shifted = { ...index, value: index.value + (previous.rank < 0 ? -HYSTERESIS : HYSTERESIS) };
  return levelOf(shifted) === previousKey ? previousKey : candidate;
}

/**
 * Levels crossed when going from `fromKey` to `toKey`, in order, the last
 * one being `toKey` — one scene event per crossed level, so a scene on
 * "cold_high" fires even if the index jumps straight to "cold_very_high".
 * `direction` is "worsening" when the level moves away from comfortable.
 */
export function crossedLevels(fromKey, toKey) {
  const from = getLevel(fromKey).rank;
  const to = getLevel(toKey).rank;
  if (from === to) {
    return [];
  }
  const step = to > from ? 1 : -1;
  const crossed = [];
  for (let rank = from + step; ; rank += step) {
    const level = LEVELS.find((l) => l.rank === rank);
    const previous = rank - step;
    crossed.push({
      level: level.key,
      direction: Math.abs(rank) > Math.abs(previous) ? 'worsening' : 'improving',
    });
    if (rank === to) {
      return crossed;
    }
  }
}

/**
 * Most severe index over a list of hourly entries (the next 24 hours).
 * @param {Array<{ datetime: string, temperature: number, dew_point?: number,
 *   humidity?: number, wind_speed?: number }>} hours wind in m/s
 */
export function worstHour(hours) {
  let worst;
  for (const hour of hours ?? []) {
    const index = feelsLikeIndex({
      temperature: hour.temperature,
      dew_point: hour.dew_point,
      humidity: hour.humidity,
      wind_kmh: Number.isFinite(hour.wind_speed) ? hour.wind_speed * 3.6 : undefined,
    });
    if (!index || index.kind === INDEX_KINDS.NONE) {
      continue;
    }
    const rank = Math.abs(getLevel(levelOf(index)).rank);
    const extremity = index.kind === INDEX_KINDS.WIND_CHILL ? -index.value : index.value;
    if (!worst || rank > worst.rank || (rank === worst.rank && extremity > worst.extremity)) {
      worst = { hour, index, level: levelOf(index), rank, extremity };
    }
  }
  return worst && { hour: worst.hour, index: worst.index, level: worst.level };
}
