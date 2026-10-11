// -----------------------------------------------------------------------------
// Derived indicators of a snapshot (pure functions), shown by the widget:
// muggy nights, black ice risk, pressure trend.
// -----------------------------------------------------------------------------

import { CONDITIONS } from './conditions.js';

const HOUR = 3_600_000;

/** The forecast hours from the current hour to `span` hours ahead. */
export function upcomingHours(snapshot, now = Date.now(), span = 24) {
  return (snapshot?.hours ?? []).filter((hour) => {
    const t = Date.parse(hour.datetime);
    return t > now - HOUR && t <= now + span * HOUR;
  });
}

/**
 * Muggy / oppressive night: the dew point stays high after sunset, the body
 * cannot cool down. Thresholds of the usual comfort scales: 18 °C muggy,
 * 20 °C oppressive. `undefined` when the source gives no dew point.
 */
export function muggyNight(snapshot, now = Date.now()) {
  const nights = upcomingHours(snapshot, now).filter(
    (hour) => hour.is_day === false && Number.isFinite(hour.dew_point),
  );
  if (nights.length === 0) {
    return undefined;
  }
  const dewPoint = Math.max(...nights.map((hour) => hour.dew_point));
  const level = dewPoint >= 20 ? 'oppressive' : dewPoint >= 18 ? 'muggy' : 'none';
  return { level, dew_point: dewPoint };
}

const FREEZING = [CONDITIONS.FREEZING_RAIN, CONDITIONS.FREEZING_FOG];
const nearZero = (t, min, max) => Number.isFinite(t) && t >= min && t <= max;

/**
 * Black ice risk over the next 24 hours: freezing rain or fog announced, or
 * precipitation around 0 °C.
 *   likely   freezing rain, or liquid precipitation between -3 and +0.5 °C
 *   possible freezing fog, or a 30 % chance of precipitation between -2 and +1 °C
 */
export function iceRisk(snapshot, now = Date.now()) {
  const hours = upcomingHours(snapshot, now);
  const likely = hours.find(
    (h) =>
      h.weather === CONDITIONS.FREEZING_RAIN ||
      (h.rain > 0 && h.precipitation >= 0.2 && nearZero(h.temperature, -3, 0.5)),
  );
  if (likely) {
    return { level: 'likely', hour: likely };
  }
  const possible = hours.find(
    (h) =>
      FREEZING.includes(h.weather) ||
      (h.precipitation_probability >= 30 && nearZero(h.temperature, -2, 1)),
  );
  if (possible || FREEZING.includes(snapshot?.current?.weather)) {
    return { level: 'possible', hour: possible };
  }
  return { level: 'none' };
}

/**
 * Pressure trend over 3 hours (hPa). The observed ECCC tendency when the
 * source gives one, otherwise the next 3 forecast hours.
 */
export function pressureTrend(snapshot, now = Date.now()) {
  let change = snapshot?.current?.pressure_change_3h;
  if (!Number.isFinite(change)) {
    const hours = upcomingHours(snapshot, now, 4).filter((h) => Number.isFinite(h.pressure));
    if (hours.length < 2) {
      return undefined;
    }
    const first = hours[0];
    const later = hours.find(
      (h) => Date.parse(h.datetime) >= Date.parse(first.datetime) + 3 * HOUR,
    );
    if (!later) {
      return undefined;
    }
    change = later.pressure - first.pressure;
  }
  let trend = 'steady';
  if (change <= -3) {
    trend = 'falling_fast';
  } else if (change <= -1) {
    trend = 'falling';
  } else if (change >= 1) {
    trend = 'rising';
  }
  return { trend, change: Math.round(change * 10) / 10 };
}
