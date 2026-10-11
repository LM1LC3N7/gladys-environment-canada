// -----------------------------------------------------------------------------
// Air Quality Health Index of ECCC: observations and forecasts.
//
// OGC API, three collections keyed by an AQHI location id ("EHHUN" is
// Montréal):
//   aqhi-stations                one point per AQHI community (about 130);
//   aqhi-observations-realtime   hourly observed AQHI (decimals), `latest`;
//   aqhi-forecasts-realtime      issued twice a day: hourly values for about
//                                two days, plus one "period" record (Today,
//                                Tonight, Tomorrow...) with the AQHI expected
//                                in wildfire smoke (`aqhi_insmoke`) when ECCC
//                                publishes one.
// Some communities have forecasts but no observation (Montréal and Québec:
// their air is measured by the province): the current value is then the
// forecast of the current hour, and says so.
// -----------------------------------------------------------------------------

import { ECCC_API_URL } from '../constants.js';
import { fetchJson } from '../http.js';
import { distanceKm } from '../geo.js';
import { num } from '../units.js';

const COLLECTIONS = `${ECCC_API_URL}/collections`;
// Growing search boxes (degrees) around the house.
const SEARCH_RADII = [0.5, 1.5];
// An AQHI describes the air of one urban area: farther than this, it says
// nothing of the air at the house.
export const MAX_STATION_DISTANCE_KM = 75;
// An observation older than this is not "now" anymore.
const MAX_OBSERVATION_AGE = 3 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const bilingual = (p, field) => ({
  en: p?.[`${field}_en`],
  fr: p?.[`${field}_fr`] ?? p?.[`${field}_en`],
});

/** Nearest AQHI community within MAX_STATION_DISTANCE_KM, or undefined. */
export async function findNearestStation(latitude, longitude, { timeout } = {}) {
  for (const radius of SEARCH_RADII) {
    const bbox = [longitude - radius, latitude - radius, longitude + radius, latitude + radius]
      .map((v) => v.toFixed(4))
      .join(',');
    const body = await fetchJson(
      `${COLLECTIONS}/aqhi-stations/items?f=json&limit=100&bbox=${bbox}`,
      {
        timeout,
      },
    );
    const nearest = (body?.features ?? [])
      .filter((f) => f?.geometry?.type === 'Point' && f.id)
      .map((f) => {
        const [lon, lat] = f.geometry.coordinates;
        return {
          id: String(f.id),
          name: bilingual(f.properties, 'location_name'),
          distanceKm: distanceKm(latitude, longitude, lat, lon),
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];
    if (nearest) {
      return nearest.distanceKm <= MAX_STATION_DISTANCE_KM ? nearest : undefined;
    }
  }
  return undefined;
}

/** The latest observation of a community, when it is recent. */
export function parseObservation(body, now = Date.now()) {
  const p = (body?.features ?? [])
    .map((f) => f?.properties)
    .filter((props) => props && Number.isFinite(num(props.aqhi)))
    .sort((a, b) => Date.parse(b.observation_datetime) - Date.parse(a.observation_datetime))[0];
  const at = Date.parse(p?.observation_datetime);
  if (!p || !Number.isFinite(at) || now - at > MAX_OBSERVATION_AGE) {
    return undefined;
  }
  const notes = bilingual(p, 'special_notes');
  return {
    value: num(p.aqhi),
    datetime: new Date(at).toISOString(),
    notes: notes.en || notes.fr ? notes : undefined,
  };
}

/**
 * The latest forecast of a community: its hourly values from the current hour
 * on, and its named periods.
 */
export function parseForecast(body, now = Date.now()) {
  const records = (body?.features ?? []).map((f) => f?.properties).filter(Boolean);
  const issued = records
    .map((p) => Date.parse(p.publication_datetime))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (issued === undefined) {
    return undefined;
  }
  const latest = records.filter((p) => Date.parse(p.publication_datetime) === issued);
  const hours = latest
    .filter((p) => p.forecast_datetime && Number.isFinite(num(p.aqhi)))
    .map((p) => ({ datetime: new Date(p.forecast_datetime).toISOString(), value: num(p.aqhi) }))
    .filter((h) => Date.parse(h.datetime) > now - HOUR)
    .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
  const periodRecord = latest.find(
    (p) => p.forecast_period && typeof p.forecast_period === 'object',
  );
  const periods = Object.entries(periodRecord?.forecast_period ?? {})
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([, period]) => ({
      name: bilingual(period, 'forecast_period'),
      value: num(period?.aqhi),
      smoke: num(period?.aqhi_insmoke),
    }))
    .filter((period) => Number.isFinite(period.value));
  return { issued: new Date(issued).toISOString(), hours, periods };
}

/**
 * The air quality at a community: the current value (observed, else
 * forecast for this hour), the hourly forecast and the periods.
 * @returns {Promise<object | undefined>} undefined when the forecast and the
 *   observation are both missing.
 */
export async function fetchAirQuality(station, { timeout, now = Date.now() } = {}) {
  const id = encodeURIComponent(station.id);
  const [observations, forecasts] = await Promise.allSettled([
    fetchJson(
      `${COLLECTIONS}/aqhi-observations-realtime/items?f=json&location_id=${id}&latest=true`,
      {
        timeout,
      },
    ),
    fetchJson(
      `${COLLECTIONS}/aqhi-forecasts-realtime/items?f=json&location_id=${id}&sortby=-publication_datetime&limit=80`,
      { timeout },
    ),
  ]);
  if (observations.status === 'rejected' && forecasts.status === 'rejected') {
    throw forecasts.reason;
  }
  const observed =
    observations.status === 'fulfilled' ? parseObservation(observations.value, now) : undefined;
  const forecast =
    forecasts.status === 'fulfilled' ? parseForecast(forecasts.value, now) : undefined;
  return buildAirQuality(station, observed, forecast, now);
}

/** Combine an observation and a forecast (pure). */
export function buildAirQuality(station, observed, forecast, now = Date.now()) {
  const thisHour = forecast?.hours.find((h) => Math.abs(Date.parse(h.datetime) - now) < HOUR);
  let current;
  if (observed) {
    current = { ...observed, observed: true };
  } else if (thisHour) {
    current = { value: thisHour.value, datetime: thisHour.datetime, observed: false };
  }
  if (!current && !forecast?.hours.length && !forecast?.periods.length) {
    return undefined;
  }
  const next24 = (forecast?.hours ?? []).filter(
    (h) => Date.parse(h.datetime) >= now - HOUR && Date.parse(h.datetime) < now + 24 * HOUR,
  );
  const peak = next24.reduce((max, h) => (max && max.value >= h.value ? max : h), undefined);
  return {
    station,
    current,
    hours: next24,
    peak,
    periods: forecast?.periods ?? [],
    issued: forecast?.issued,
  };
}
