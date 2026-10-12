// -----------------------------------------------------------------------------
// Air Quality Health Index (AQHI) of Health Canada and ECCC (pure functions).
//
// A 1-to-10+ scale built from ozone, fine particles and nitrogen dioxide,
// published as an integer ("10+" above 10). Four risk levels, each with the
// official advice for the general population and for the people at risk
// (heart or lung conditions, children, older adults). The scene engine of
// Gladys compares exact values, so the index is turned into these discrete
// levels, like the feels-like indices (src/feelsLike.js). The advice follows
// the Health Canada wording, a few French phrases shortened to fit the
// 300-character text of a widget.
// -----------------------------------------------------------------------------

// `max` is the highest rounded AQHI of the level; `rank` orders them.
export const AQHI_LEVELS = [
  {
    key: 'low',
    rank: 0,
    max: 3,
    label: { en: 'Low risk', fr: 'Risque faible' },
    advice: {
      en: 'Ideal air quality for outdoor activities.',
      fr: 'Qualité de l’air idéale pour les activités en plein air.',
    },
    atRisk: {
      en: 'Enjoy your usual outdoor activities.',
      fr: 'Profitez de vos activités habituelles en plein air.',
    },
  },
  {
    key: 'moderate',
    rank: 1,
    max: 6,
    label: { en: 'Moderate risk', fr: 'Risque modéré' },
    advice: {
      en: 'No need to modify your usual outdoor activities unless you experience symptoms such as coughing and throat irritation.',
      fr: 'Aucun besoin de modifier vos activités habituelles en plein air à moins d’éprouver des symptômes comme la toux et une irritation de la gorge.',
    },
    atRisk: {
      en: 'Consider reducing or rescheduling strenuous activities outdoors if you are experiencing symptoms.',
      fr: 'Envisagez de réduire ou de réorganiser les activités exténuantes en plein air si vous éprouvez des symptômes.',
    },
  },
  {
    key: 'high',
    rank: 2,
    max: 10,
    label: { en: 'High risk', fr: 'Risque élevé' },
    advice: {
      en: 'Consider reducing or rescheduling strenuous activities outdoors if you experience symptoms such as coughing and throat irritation.',
      fr: 'Envisagez de réduire ou de réorganiser les activités exténuantes en plein air si vous éprouvez des symptômes comme la toux et une irritation de la gorge.',
    },
    atRisk: {
      en: 'Reduce or reschedule strenuous activities outdoors. Children and the elderly should also take it easy.',
      fr: 'Réduisez ou réorganisez les activités exténuantes en plein air. Les enfants et les aînés devraient aussi ralentir.',
    },
  },
  {
    key: 'very_high',
    rank: 3,
    max: Infinity,
    label: { en: 'Very high risk', fr: 'Risque très élevé' },
    advice: {
      en: 'Reduce or reschedule strenuous activities outdoors, especially if you experience symptoms such as coughing and throat irritation.',
      fr: 'Réduisez ou réorganisez les activités exténuantes en plein air, surtout si vous éprouvez des symptômes comme la toux et une irritation de la gorge.',
    },
    atRisk: {
      en: 'Avoid strenuous activities outdoors. Children and the elderly should also avoid outdoor physical exertion.',
      fr: 'Évitez les activités exténuantes en plein air. Les enfants et les personnes âgées devraient aussi éviter les efforts dehors.',
    },
  },
];

const BY_KEY = new Map(AQHI_LEVELS.map((level) => [level.key, level]));

export const getAqhiLevel = (key) => BY_KEY.get(key);

/**
 * The AQHI as the public reads it: an integer from 1, observations come with
 * decimals (2.12 is a 2).
 */
export function roundAqhi(value) {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : undefined;
}

/** "10+" above 10, the way ECCC prints it. */
export function formatAqhi(value) {
  const rounded = roundAqhi(value);
  if (rounded === undefined) {
    return '–';
  }
  return rounded > 10 ? '10+' : String(rounded);
}

/** Risk level key of an AQHI value. */
export function aqhiLevelOf(value) {
  const rounded = roundAqhi(value);
  if (rounded === undefined) {
    return undefined;
  }
  return AQHI_LEVELS.find((level) => rounded <= level.max).key;
}

/**
 * The level, with a 1-unit margin to leave a level downwards: an AQHI
 * wavering between 6 and 7 must not fire a scene every hour.
 */
export function aqhiLevelWithHysteresis(value, previousKey) {
  const level = aqhiLevelOf(value);
  const previous = getAqhiLevel(previousKey);
  if (!level || !previous) {
    return level;
  }
  if (getAqhiLevel(level).rank < previous.rank && aqhiLevelOf(roundAqhi(value) + 1) !== level) {
    return previousKey;
  }
  return level;
}

/**
 * Every level crossed between two levels, in the order they are crossed, so
 * a scene filtered on "high" still fires when the AQHI jumps from low to
 * very high.
 * @returns {{ level: string, direction: 'worsening' | 'improving' }[]}
 */
export function crossedAqhiLevels(fromKey, toKey) {
  const from = getAqhiLevel(fromKey)?.rank;
  const to = getAqhiLevel(toKey)?.rank;
  if (from === undefined || to === undefined || from === to) {
    return [];
  }
  const direction = to > from ? 'worsening' : 'improving';
  const step = to > from ? 1 : -1;
  const crossed = [];
  for (let rank = from + step; step > 0 ? rank <= to : rank >= to; rank += step) {
    crossed.push({ level: AQHI_LEVELS[rank].key, direction });
  }
  return crossed;
}
