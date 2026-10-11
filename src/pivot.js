// -----------------------------------------------------------------------------
// Snapshot (metric, language-free) -> pivot weather format of Gladys (B.18),
// in the unit system and the language of the request.
//
// The core normalizes and bounds the payload anyway (unknown fields dropped,
// arrays capped): building it within the limits here keeps what we send and
// what the user sees identical.
// -----------------------------------------------------------------------------

import {
  MAX_ALERTS,
  MAX_ALERT_DESCRIPTION_LENGTH,
  MAX_ALERT_EVENT_LENGTH,
  MAX_DAYS,
  MAX_HOURS,
} from './constants.js';
import { upcomingHours } from './indicators.js';
import { sunTimes } from './sun.js';
import { celsiusToFahrenheit, kmToMiles, mmToInches, msToMph, round } from './units.js';

export const UNITS = { METRIC: 'metric', US: 'us' };

/** Language of the texts we hold (French or English). */
export function textLanguage(language) {
  return typeof language === 'string' && language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function converters(units) {
  const us = units === UNITS.US;
  return {
    temperature: (c) => round(us ? celsiusToFahrenheit(c) : c, 1),
    speed: (ms) => round(us ? msToMph(ms) : ms, 1),
    precipitation: (mm) => round(us ? mmToInches(mm) : mm, us ? 2 : 1),
    distance: (km) => round(us ? kmToMiles(km) : km, 1),
    plain: (v) => round(v, 1),
  };
}

// Pivot field -> converter kind.
const FIELD_KINDS = {
  temperature: 'temperature',
  apparent_temperature: 'temperature',
  dew_point: 'temperature',
  temperature_min: 'temperature',
  temperature_max: 'temperature',
  wind_speed: 'speed',
  wind_gust: 'speed',
  precipitation: 'precipitation',
  visibility: 'distance',
  humidity: 'plain',
  pressure: 'plain',
  wind_direction: 'plain',
  cloud_cover: 'plain',
  precipitation_probability: 'plain',
  uv_index: 'plain',
};

function copy(source, fields, convert) {
  const target = {};
  for (const field of fields) {
    const value = convert[FIELD_KINDS[field]](source[field]);
    if (value !== undefined) {
      target[field] = value;
    }
  }
  return target;
}

const CURRENT_FIELDS = [
  'apparent_temperature',
  'humidity',
  'pressure',
  'dew_point',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'visibility',
  'cloud_cover',
  'uv_index',
];
const HOUR_FIELDS = [
  'apparent_temperature',
  'humidity',
  'pressure',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'cloud_cover',
  'precipitation',
  'precipitation_probability',
  'uv_index',
];
const DAY_FIELDS = [
  'humidity',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'precipitation',
  'precipitation_probability',
  'uv_index',
];

/** Local calendar date (YYYY-MM-DD) of an instant, given the UTC offset. */
export function localDate(instant, utcOffsetMinutes = 0) {
  return new Date(Date.parse(instant) + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

// Local noon of a calendar day, as an instant: unambiguous whatever the
// time zone the dashboard is displayed in.
const localNoon = (date, utcOffsetMinutes = 0) =>
  new Date(Date.parse(`${date}T12:00:00Z`) - utcOffsetMinutes * 60_000).toISOString();

function addSun(target, date, latitude, longitude) {
  const { sunrise, sunset } = sunTimes(date, latitude, longitude);
  if (sunrise && sunset) {
    target.sunrise = sunrise.toISOString();
    target.sunset = sunset.toISOString();
  }
}

const truncate = (text, max) =>
  typeof text === 'string' && text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Pivot alerts from the bilingual alerts we hold. */
export function pivotAlerts(alerts, language) {
  const lang = textLanguage(language);
  return (alerts ?? []).slice(0, MAX_ALERTS).map((alert) => {
    const pivot = {
      severity: alert.severity,
      event: truncate(alert.event[lang] ?? alert.event.en, MAX_ALERT_EVENT_LENGTH),
    };
    const description = alert.description?.[lang] ?? alert.description?.en;
    if (description) {
      pivot.description = truncate(description.trim(), MAX_ALERT_DESCRIPTION_LENGTH);
    }
    for (const field of ['type', 'start', 'end']) {
      if (alert[field]) {
        pivot[field] = alert[field];
      }
    }
    return pivot;
  });
}

/**
 * @param {object} snapshot see src/sources/*.js
 * @param {{ latitude: number, longitude: number, units: string, language: string,
 *   alerts?: object[], images?: object[], now?: number }} options
 */
export function toPivot(snapshot, { latitude, longitude, units, language, alerts, images, now }) {
  const at = now ?? Date.now();
  const convert = converters(units);
  const { current } = snapshot;
  const offset = snapshot.utcOffsetMinutes ?? 0;
  const today = localDate(new Date(at).toISOString(), offset);

  const payload = {
    temperature: convert.temperature(current.temperature),
    weather: current.weather,
    datetime: current.datetime,
    ...copy(current, CURRENT_FIELDS, convert),
  };
  addSun(payload, today, latitude, longitude);
  if (typeof current.is_day === 'boolean') {
    payload.is_day = current.is_day;
  }

  payload.hours = upcomingHours(snapshot, at)
    .slice(0, MAX_HOURS)
    .map((hour) => {
      const entry = {
        temperature: convert.temperature(hour.temperature),
        weather: hour.weather,
        datetime: hour.datetime,
        ...copy(hour, HOUR_FIELDS, convert),
      };
      if (typeof hour.is_day === 'boolean') {
        entry.is_day = hour.is_day;
      }
      return entry;
    });

  payload.days = (snapshot.days ?? [])
    .filter((day) => day.date >= today)
    .slice(0, MAX_DAYS)
    .map((day) => {
      const entry = {
        temperature_min: convert.temperature(day.temperature_min),
        temperature_max: convert.temperature(day.temperature_max),
        datetime: localNoon(day.date, offset),
        ...copy(day, DAY_FIELDS, convert),
      };
      if (day.weather) {
        entry.weather = day.weather;
      }
      addSun(entry, day.date, latitude, longitude);
      return entry;
    });

  payload.alerts = pivotAlerts(alerts, language);
  if (images?.length) {
    payload.images = images;
  }
  return payload;
}
