// -----------------------------------------------------------------------------
// Environment and Climate Change Canada city pages: the forecasts.
//
// OGC API: https://api.weather.gc.ca/collections/citypageweather-realtime
// One feature per city (point geometry): current conditions (with the
// official humidex / wind chill), 24 hourly forecasts, ~6 days of day/night
// periods. The nearest city is looked up once with a bbox search, then read
// by id.
// -----------------------------------------------------------------------------

import { ECCC_API_URL } from '../constants.js';
import { fetchJson } from '../http.js';
import { ecccCondition, ecccIsNightIcon } from '../conditions.js';
import { distanceKm } from '../geo.js';
import { dewPointFromHumidity } from '../feelsLike.js';
import { isDaylight } from '../sun.js';
import { utcOffsetMinutes } from '../timezone.js';
import { compassToDegrees, kmhToMs, kpaToHpa, num } from '../units.js';

export const ECCC_SOURCE = 'eccc';

const COLLECTION_URL = `${ECCC_API_URL}/collections/citypageweather-realtime/items`;
// Growing search boxes (degrees): most homes have a city page within 20 km.
const SEARCH_RADII = [0.3, 1.5];
// Beyond this, the city page describes another climate: better no fallback.
const MAX_CITY_DISTANCE_KM = 150;

// Bilingual leaves look like { en: x, fr: x }; numbers are the same in both.
const pick = (node) => (node && typeof node === 'object' && 'en' in node ? node.en : node);
const value = (node) => pick(node?.value);
const number = (node) => num(value(node));

// "calm" is a wind speed too.
function windKmh(node) {
  const raw = value(node);
  if (typeof raw === 'string' && /calm|calme/i.test(raw)) {
    return 0;
  }
  return num(raw);
}

const ms = (kmh) => (kmh === undefined ? undefined : kmhToMs(kmh));

/**
 * Nearest city page feature of a location (the whole feature, so the first
 * call needs no second request).
 */
export async function findNearestCity(latitude, longitude, { timeout } = {}) {
  for (const radius of SEARCH_RADII) {
    const bbox = [longitude - radius, latitude - radius, longitude + radius, latitude + radius]
      .map((v) => v.toFixed(4))
      .join(',');
    const body = await fetchJson(`${COLLECTION_URL}?f=json&limit=100&bbox=${bbox}`, { timeout });
    const candidates = (body?.features ?? [])
      .filter((f) => f?.geometry?.type === 'Point')
      .map((feature) => {
        const [lon, lat] = feature.geometry.coordinates;
        return { feature, distance: distanceKm(latitude, longitude, lat, lon) };
      })
      .sort((a, b) => a.distance - b.distance);
    if (candidates.length > 0) {
      if (candidates[0].distance > MAX_CITY_DISTANCE_KM) {
        break;
      }
      return candidates[0].feature;
    }
  }
  throw new Error('ECCC: no city page near this location');
}

export async function fetchCityPage(id, { timeout } = {}) {
  return fetchJson(`${COLLECTION_URL}/${encodeURIComponent(id)}?f=json`, { timeout });
}

// Official humidex / wind chill when ECCC publishes one.
const officialFeelsLike = (node) => number(node?.humidex) ?? number(node?.windChill);

function parseCurrent(cc, latitude, longitude, firstHour) {
  const temperature = number(cc?.temperature);
  const datetime = pick(cc?.timestamp);
  if (temperature === undefined || typeof datetime !== 'string') {
    return undefined;
  }
  const humidity = number(cc.relativeHumidity);
  const icon = cc.iconCode?.value ?? firstHour?.icon;
  // Observed 3-hour tendency: ECCC gives the absolute change and its sign
  // in words.
  const change = num(pick(cc.pressure?.change));
  const tendency = String(pick(cc.pressure?.tendency) ?? '');
  return {
    pressure_change_3h:
      change === undefined ? undefined : kpaToHpa(/falling/i.test(tendency) ? -change : change),
    datetime: new Date(datetime).toISOString(),
    temperature,
    apparent_temperature: officialFeelsLike(cc) ?? temperature,
    dew_point: number(cc.dewpoint) ?? dewPointFromHumidity(temperature, humidity),
    humidity,
    pressure: number(cc.pressure) === undefined ? undefined : kpaToHpa(number(cc.pressure)),
    wind_speed: ms(windKmh(cc.wind?.speed)),
    wind_direction: number(cc.wind?.bearing) ?? compassToDegrees(value(cc.wind?.direction)),
    wind_gust: ms(number(cc.wind?.gust)),
    visibility: number(cc.visibility),
    uv_index: firstHour?.uv_index,
    weather: ecccCondition(icon, temperature),
    is_day: ecccIsNightIcon(icon) ? false : isDaylight(datetime, latitude, longitude),
  };
}

function parseHour(entry, latitude, longitude) {
  const temperature = number(entry?.temperature);
  const datetime = typeof entry?.timestamp === 'string' ? entry.timestamp : undefined;
  if (temperature === undefined || datetime === undefined) {
    return undefined;
  }
  const icon = entry.iconCode?.value;
  return {
    datetime: new Date(datetime).toISOString(),
    temperature,
    apparent_temperature: officialFeelsLike(entry) ?? temperature,
    wind_speed: ms(windKmh(entry.wind?.speed)),
    wind_direction: compassToDegrees(value(entry.wind?.direction)),
    wind_gust: ms(number(entry.wind?.gust)),
    precipitation_probability: number(entry.lop),
    uv_index: num(pick(entry.uv?.index?.value)),
    weather: ecccCondition(icon, temperature),
    is_day: ecccIsNightIcon(icon) ? false : isDaylight(datetime, latitude, longitude),
    icon,
  };
}

const isNightPeriod = (period) =>
  /night|tonight/i.test(`${pick(period?.value)} ${pick(period?.textForecastName)}`);

function temperatureOf(forecast, kind) {
  const list = forecast?.temperatures?.temperature;
  const entries = Array.isArray(list) ? list : [list];
  return num(value(entries.find((t) => pick(t?.class) === kind)));
}

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pair the day/night periods into calendar days. ECCC gives no date per
 * period: they follow the issue time, a day period starting each new date.
 */
export function parseDays(forecastGroup, utcOffsetMinutes) {
  const forecasts = forecastGroup?.forecasts ?? [];
  const issued = Date.parse(pick(forecastGroup?.timestamp));
  if (!Number.isFinite(issued) || forecasts.length === 0) {
    return [];
  }
  const base = new Date(issued + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
  const days = [];
  let offset = isNightPeriod(forecasts[0].period) ? 1 : 0;
  let current;
  for (const forecast of forecasts) {
    if (isNightPeriod(forecast.period)) {
      current ??= { date: base };
      current.temperature_min = temperatureOf(forecast, 'low');
      if (!days.includes(current)) {
        days.push(current);
      }
      current = undefined;
      continue;
    }
    const high = temperatureOf(forecast, 'high');
    const wind = forecast.winds?.periods?.[0];
    current = {
      date: addDays(base, offset),
      temperature_max: high,
      weather: ecccCondition(forecast.abbreviatedForecast?.icon?.value, high),
      humidity: number(forecast.relativeHumidity),
      wind_speed: ms(number(wind?.speed)),
      wind_direction: number(wind?.bearing),
      uv_index: num(pick(forecast.uv?.index)),
    };
    days.push(current);
    offset += 1;
  }
  return days
    .filter((d) => d.temperature_min !== undefined && d.temperature_max !== undefined)
    .map((d) => ({
      ...d,
      temperature_min: Math.min(d.temperature_min, d.temperature_max),
      temperature_max: Math.max(d.temperature_min, d.temperature_max),
    }));
}

/**
 * Snapshot of a city page feature. The UTC offset of the place (from the
 * province of its id, "qc-147") dates the daily periods and the local hours.
 */
export function parseCityPage(feature, latitude, longitude, now = Date.now()) {
  const props = feature?.properties;
  const province = String(props?.identifier ?? feature?.id ?? '').split('-')[0];
  const offset = utcOffsetMinutes(province, latitude, longitude, now);
  const hours = (props?.hourlyForecastGroup?.hourlyForecasts ?? [])
    .map((entry) => parseHour(entry, latitude, longitude))
    .filter(Boolean);
  const current = parseCurrent(props?.currentConditions, latitude, longitude, hours[0]);
  if (!current) {
    throw new Error('ECCC: no current conditions in the city page');
  }
  return {
    source: ECCC_SOURCE,
    utcOffsetMinutes: offset,
    station: pick(props.name),
    cityId: props.identifier ?? feature.id,
    current,
    hours: hours.map(({ icon: _icon, ...hour }) => hour),
    days: parseDays(props.forecastGroup, offset),
  };
}
