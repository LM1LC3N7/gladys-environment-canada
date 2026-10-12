// -----------------------------------------------------------------------------
// Dashboard widgets "Feels like" and "Air quality" (manifest `widgets`,
// Gladys 5.1+).
//
// Feels like:
// What the native weather widget does not show: WHICH index applies (humidex
// in summer, wind chill in winter) with its ECCC risk level, the gust
// variant, the worst hour of the next 24 hours, the time to frostbite, and
// the derived indicators (muggy night, black ice, pressure trend).
//
// Air quality: the Air Quality Health Index of the nearest community with its
// risk level and the official advice, the peak of the next 24 hours, the
// forecast periods and, in wildfire season, the AQHI expected in the smoke.
//
// The content is declarative (core vocabulary, no HTML); `onWidgetGet`
// receives no coordinates: the house comes from the `house` setting (name or
// selector, empty = first house), resolved against getHouses().
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, createLogger } from '@gladysassistant/integration-sdk';
import { AIR_QUALITY_WIDGET, FEELS_LIKE_WIDGET } from './constants.js';
import { aqhiLevelOf, formatAqhi, getAqhiLevel, roundAqhi } from './aqhi.js';
import { assess } from './assessment.js';
import { INDEX_KINDS, getLevel } from './feelsLike.js';
import { iceRisk, muggyNight, pressureTrend, upcomingHours } from './indicators.js';
import {
  ICE_LABELS,
  INDEX_NAMES,
  INDEX_SHORT_NAMES,
  MUGGY_LABELS,
  PRESSURE_LABELS,
  localClock,
  signed,
} from './i18n.js';
import { UNITS, converters } from './pivot.js';
import { isInCanadaArea } from './geo.js';
import { OutsideCanadaError } from './provider.js';
import { MAX_STATION_DISTANCE_KM } from './sources/ecccAqhi.js';

const logger = createLogger({ name: 'widgets' });

const CONTENT_TTL = 600;
const MESSAGE_TTL = 60;

/** Theme color of a risk level. */
export function levelColor(levelKey) {
  const rank = getLevel(levelKey)?.rank ?? 0;
  if (rank === 0) {
    return WIDGET_COLORS.SUCCESS;
  }
  if (Math.abs(rank) >= 3) {
    return WIDGET_COLORS.DANGER;
  }
  if (rank === -1) {
    return WIDGET_COLORS.INFO;
  }
  return WIDGET_COLORS.WARNING;
}

const both = (fn) => ({ en: fn('en'), fr: fn('fr') });

// Whether `a` (an hour) is more severe than `b` (now): rank, then extremity.
function isWorse(a, b) {
  if (b.index.kind === INDEX_KINDS.NONE) {
    return true;
  }
  const rank = (x) => Math.abs(getLevel(x.level).rank);
  const extremity = (x) =>
    x.index.kind === INDEX_KINDS.WIND_CHILL ? -x.index.value : x.index.value;
  return rank(a) > rank(b) || (rank(a) === rank(b) && extremity(a) > extremity(b));
}

function message(text) {
  return { ttl_seconds: MESSAGE_TTL, components: [{ type: 'text', variant: 'body', text }] };
}

const OUTSIDE_CANADA = {
  en: 'Environment Canada only covers Canada: this house is outside.',
  fr: 'Environnement Canada ne couvre que le Canada : cette maison est en dehors.',
};

function noHouse(name) {
  return message(
    name
      ? {
          en: `No located house named "${name}".`,
          fr: `Aucune maison localisée nommée « ${name} ».`,
        }
      : {
          en: 'No location yet: place your house on the map in Gladys.',
          fr: 'Aucune position : placez votre maison sur la carte dans Gladys.',
        },
  );
}

/**
 * Build the widget content of a snapshot (pure: tested without network).
 * @param {object} snapshot
 * @param {{ units?: string, now?: number }} options
 */
export function buildFeelsLikeContent(snapshot, { units, now = Date.now() } = {}) {
  const assessment = assess(snapshot, now);
  const convert = converters(units);
  const unit = units === UNITS.US ? '°F' : '°C';
  const temperature = (c) => Math.round(convert.temperature(c));
  const offset = snapshot.utcOffsetMinutes ?? 0;
  const { current } = snapshot;
  const { index } = assessment;
  const level = getLevel(assessment.level);
  const color = levelColor(assessment.level);
  // Humidex has no unit; the wind chill reads as a temperature.
  const indexValue = (i) => (i.kind === INDEX_KINDS.HUMIDEX ? i.value : temperature(i.value));
  const indexUnit = (i) => (i.kind === INDEX_KINDS.HUMIDEX ? '' : unit);

  const components = [
    {
      type: 'text',
      variant: 'heading',
      text: both(
        (lang) =>
          `${INDEX_NAMES[index.kind][lang]} ${signed(indexValue(index))}${indexUnit(index)}`,
      ),
    },
  ];

  // Tiles: the index that applies (ECCC's own scales), then the air.
  if (index.kind !== INDEX_KINDS.NONE) {
    components.push({
      type: 'value',
      label: INDEX_SHORT_NAMES[index.kind],
      value: indexValue(index),
      ...(indexUnit(index) ? { unit } : {}),
      icon: index.kind === INDEX_KINDS.HUMIDEX ? 'sun' : 'wind',
      color,
    });
  }
  components.push({
    type: 'value',
    label: { en: 'Temperature', fr: 'Température' },
    value: temperature(current.temperature),
    unit,
    icon: 'thermometer',
  });
  if (assessment.gustWindChill !== undefined) {
    components.push({
      type: 'value',
      label: { en: 'In the gusts', fr: 'Dans les rafales' },
      value: temperature(assessment.gustWindChill),
      unit,
      icon: 'wind',
    });
  } else if (Number.isFinite(current.dew_point)) {
    components.push({
      type: 'value',
      label: { en: 'Dew point', fr: 'Point de rosée' },
      value: temperature(current.dew_point),
      unit,
      icon: 'droplet',
    });
  }

  // Focal chart: feels-like and temperature over the next 24 hours.
  const hours = upcomingHours(snapshot, now).filter((h) => Number.isFinite(h.temperature));
  if (hours.length > 1) {
    const series = [
      {
        name: { en: 'Feels like', fr: 'Ressenti' },
        points: hours
          .filter((h) => Number.isFinite(h.apparent_temperature))
          .map((h) => ({ t: h.datetime, v: temperature(h.apparent_temperature) })),
      },
      {
        name: { en: 'Temperature', fr: 'Température' },
        points: hours.map((h) => ({ t: h.datetime, v: temperature(h.temperature) })),
      },
    ].filter((s) => s.points.length > 0);
    const chart = {
      type: 'chart',
      chart_type: 'line',
      title: { en: 'Next 24 hours', fr: 'Prochaines 24 h' },
      unit,
      now_marker: true,
      series,
    };
    if (assessment.worst) {
      chart.annotations = [
        {
          t: assessment.worst.hour.datetime,
          label: { en: 'Worst', fr: 'Pire' },
          color: levelColor(assessment.worst.level),
        },
      ];
    }
    components.push(chart);
  }

  // Status rows.
  const items = [
    {
      label: { en: 'Risk level', fr: 'Niveau de risque' },
      value: level.label,
      icon: 'alert-triangle',
      color,
    },
  ];
  if (assessment.worst) {
    // Now may be worse than any coming hour: say so rather than show a
    // milder "worst" hour.
    const nowIsWorst = !isWorse(assessment.worst, assessment);
    const worst = nowIsWorst ? assessment : assessment.worst;
    const at = nowIsWorst
      ? { en: 'Now', fr: 'Maintenant' }
      : both(() => localClock(assessment.worst.hour.datetime, offset));
    items.push({
      label: { en: 'Worst hour (24 h)', fr: 'Pire heure (24 h)' },
      value: both(
        (lang) =>
          `${at[lang]} · ${INDEX_SHORT_NAMES[worst.index.kind][lang]} ${signed(indexValue(worst.index))}${indexUnit(worst.index)}`,
      ),
      icon: 'clock',
      color: levelColor(worst.level),
    });
  }
  if (level.frostbite) {
    items.push({
      label: { en: 'Time to frostbite', fr: 'Délai de gelure' },
      value: level.frostbite,
      icon: 'alert-octagon',
      color,
    });
  }
  const muggy = muggyNight(snapshot, now);
  if (muggy && muggy.level !== 'none') {
    items.push({
      label: { en: 'Muggy night', fr: 'Nuit étouffante' },
      value: MUGGY_LABELS[muggy.level],
      icon: 'moon',
      color: muggy.level === 'oppressive' ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
    });
  }
  const ice = iceRisk(snapshot, now);
  if (ice.level !== 'none') {
    items.push({
      label: { en: 'Black ice', fr: 'Verglas' },
      value: ice.hour
        ? both(
            (lang) => `${ICE_LABELS[ice.level][lang]} · ${localClock(ice.hour.datetime, offset)}`,
          )
        : ICE_LABELS[ice.level],
      icon: 'alert-circle',
      color: ice.level === 'likely' ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
    });
  }
  const pressure = pressureTrend(snapshot, now);
  if (pressure) {
    items.push({
      label: { en: 'Pressure (3 h)', fr: 'Pression (3 h)' },
      value: both(
        (lang) =>
          `${PRESSURE_LABELS[pressure.trend][lang]} (${pressure.change > 0 ? '+' : ''}${signed(pressure.change)} hPa)`,
      ),
      icon: { rising: 'trending-up', steady: 'minus' }[pressure.trend] ?? 'trending-down',
      color: pressure.trend === 'falling_fast' ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (snapshot.station) {
    items.push({
      label: { en: 'Forecast for', fr: 'Prévisions pour' },
      value: snapshot.station,
      icon: 'map-pin',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });
  components.push({ type: 'text', variant: 'caption', text: level.advice });

  return { ttl_seconds: CONTENT_TTL, components };
}

/** Theme color of an AQHI risk level. */
export function aqhiColor(levelKey) {
  return (
    {
      low: WIDGET_COLORS.SUCCESS,
      moderate: WIDGET_COLORS.WARNING,
      high: WIDGET_COLORS.DANGER,
      very_high: WIDGET_COLORS.DANGER,
    }[levelKey] ?? WIDGET_COLORS.NEUTRAL
  );
}

// The gauge stops at 11, the "10+" of the scale.
const AQHI_GAUGE_MAX = 11;

/**
 * Build the air quality widget content (pure: tested without network).
 * @param {object} airQuality see src/sources/ecccAqhi.js
 * @param {{ utcOffsetMinutes?: number }} options local time of the house
 */
export function buildAirQualityContent(airQuality, { utcOffsetMinutes = 0 } = {}) {
  const { current, peak, periods, station } = airQuality;
  const levelKey = aqhiLevelOf(current?.value ?? peak?.value);
  const level = getAqhiLevel(levelKey);
  const color = aqhiColor(levelKey);
  const components = [];

  if (current) {
    components.push({
      type: 'text',
      variant: 'heading',
      text: {
        en: `AQHI ${formatAqhi(current.value)} · ${level.label.en}`,
        fr: `Cote air santé ${formatAqhi(current.value)} · ${level.label.fr}`,
      },
    });
    components.push({
      type: 'gauge',
      value: Math.min(roundAqhi(current.value), AQHI_GAUGE_MAX),
      min: 1,
      max: AQHI_GAUGE_MAX,
      label: current.observed
        ? { en: 'Now', fr: 'Maintenant' }
        : { en: 'Forecast now', fr: 'Prévue maintenant' },
      color,
    });
  }
  if (peak) {
    components.push({
      type: 'value',
      label: { en: 'Peak (24 h)', fr: 'Maximum (24 h)' },
      value: formatAqhi(peak.value),
      icon: 'trending-up',
      color: aqhiColor(aqhiLevelOf(peak.value)),
    });
  }
  const smoke = periods.find((p) => Number.isFinite(p.smoke));
  if (smoke) {
    components.push({
      type: 'value',
      label: { en: 'In wildfire smoke', fr: 'Dans la fumée' },
      value: formatAqhi(smoke.smoke),
      icon: 'alert-triangle',
      color: aqhiColor(aqhiLevelOf(smoke.smoke)),
    });
  }

  // Focal chart: the hourly forecast.
  if (airQuality.hours.length > 1) {
    const chart = {
      type: 'chart',
      chart_type: 'bar',
      title: { en: 'Next 24 hours', fr: 'Prochaines 24 h' },
      now_marker: true,
      series: [
        {
          name: { en: 'AQHI', fr: 'Cote air santé' },
          points: airQuality.hours.map((h) => ({ t: h.datetime, v: roundAqhi(h.value) })),
        },
      ],
    };
    if (peak && aqhiLevelOf(peak.value) !== 'low') {
      chart.annotations = [
        {
          t: peak.datetime,
          value: roundAqhi(peak.value),
          label: { en: 'Peak', fr: 'Maximum' },
          color: aqhiColor(aqhiLevelOf(peak.value)),
        },
      ];
    }
    components.push(chart);
  }

  const items = [];
  if (level) {
    items.push({
      label: { en: 'Health risk', fr: 'Risque pour la santé' },
      value: level.label,
      icon: 'activity',
      color,
    });
  }
  for (const period of periods.slice(0, 4)) {
    const periodLevel = getAqhiLevel(aqhiLevelOf(period.value));
    items.push({
      label: period.name,
      value: {
        en: `${formatAqhi(period.value)} · ${periodLevel.label.en}`,
        fr: `${formatAqhi(period.value)} · ${periodLevel.label.fr}`,
      },
      icon: 'calendar',
      color: aqhiColor(periodLevel.key),
    });
  }
  const km = Math.round(station.distanceKm);
  const at = current ? localClock(current.datetime, utcOffsetMinutes) : undefined;
  items.push({
    label: current?.observed
      ? { en: `Measured at ${at}`, fr: `Mesurée à ${at}` }
      : { en: 'Forecast (no measurement)', fr: 'Prévision (pas de mesure)' },
    value: { en: `${station.name.en} (${km} km)`, fr: `${station.name.fr} (${km} km)` },
    icon: 'map-pin',
    color: WIDGET_COLORS.NEUTRAL,
  });
  components.push({ type: 'status', items });

  if (level) {
    components.push({
      type: 'text',
      variant: 'body',
      text: {
        en: `${level.advice.en}\nPeople at risk: ${level.atRisk.en}`,
        fr: `${level.advice.fr}\nPersonnes à risque : ${level.atRisk.fr}`,
      },
    });
  }
  return { ttl_seconds: CONTENT_TTL, components };
}

/**
 * @param {{ provider: object, watcher: object, rememberPreferences: Function }} deps
 */
export function createWidgets({ provider, watcher, rememberPreferences }) {
  return {
    [FEELS_LIKE_WIDGET]: {
      async get({ settings = {}, language, units }) {
        rememberPreferences({ language, units });
        const house = watcher.findHouse(settings.house);
        if (!house) {
          return noHouse(settings.house);
        }
        try {
          const snapshot = await provider.getSnapshot(house.latitude, house.longitude);
          return buildFeelsLikeContent(snapshot, { units });
        } catch (err) {
          logger.warn(`Feels-like widget: ${err.message}`);
          return message(
            err instanceof OutsideCanadaError
              ? OUTSIDE_CANADA
              : {
                  en: 'Weather unavailable for now, retrying soon.',
                  fr: 'Météo indisponible pour le moment, nouvel essai bientôt.',
                },
          );
        }
      },
    },
    [AIR_QUALITY_WIDGET]: {
      async get({ settings = {}, language, units }) {
        rememberPreferences({ language, units });
        const house = watcher.findHouse(settings.house);
        if (!house) {
          return noHouse(settings.house);
        }
        const { latitude, longitude } = house;
        if (!isInCanadaArea(latitude, longitude)) {
          return message(OUTSIDE_CANADA);
        }
        const airQuality = await provider.getAirQuality(latitude, longitude);
        if (!airQuality) {
          return message({
            en: `No Air Quality Health Index within ${MAX_STATION_DISTANCE_KM} km of this house, or Environment Canada does not answer for now.`,
            fr: `Aucune cote air santé à moins de ${MAX_STATION_DISTANCE_KM} km de cette maison, ou Environnement Canada ne répond pas pour le moment.`,
          });
        }
        const offset =
          provider.cachedSnapshot(latitude, longitude)?.snapshot.utcOffsetMinutes ??
          Math.round(longitude / 15) * 60;
        return buildAirQualityContent(airQuality, { utcOffsetMinutes: offset });
      },
    },
  };
}

export const WIDGET_KEYS = [FEELS_LIKE_WIDGET, AIR_QUALITY_WIDGET];
