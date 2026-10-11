// -----------------------------------------------------------------------------
// Sunrise, sunset and day/night (pure functions, no network).
//
// The ECCC city page gives the sun times of today only, not of every
// forecast day, so they are computed with the standard sunrise equation
// (NOAA/Meeus approximation, about one minute of error at our latitudes).
// -----------------------------------------------------------------------------

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J2000 = 2451545.0;
// Apparent sunrise: refraction + solar disk radius.
const HORIZON = -0.833;

const toJulian = (ms) => ms / DAY_MS + 2440587.5;
const fromJulian = (jd) => new Date((jd - 2440587.5) * DAY_MS);

/**
 * Sunrise and sunset of a calendar day at a location.
 * @param {string} date local calendar date, `YYYY-MM-DD`
 * @param {number} latitude
 * @param {number} longitude east positive
 * @returns {{ sunrise?: Date, sunset?: Date }} empty during the polar day/night
 */
export function sunTimes(date, latitude, longitude) {
  const [y, m, d] = date.split('-').map(Number);
  const n = Math.round(toJulian(Date.UTC(y, m - 1, d, 12)) - J2000);
  const meanNoon = n - longitude / 360;
  const anomaly = (357.5291 + 0.98560028 * meanNoon) % 360;
  const center =
    1.9148 * Math.sin(anomaly * RAD) +
    0.02 * Math.sin(2 * anomaly * RAD) +
    0.0003 * Math.sin(3 * anomaly * RAD);
  const eclipticLongitude = (anomaly + center + 180 + 102.9372) % 360;
  const transit =
    J2000 +
    meanNoon +
    0.0053 * Math.sin(anomaly * RAD) -
    0.0069 * Math.sin(2 * eclipticLongitude * RAD);
  const declination = Math.asin(Math.sin(eclipticLongitude * RAD) * Math.sin(23.4397 * RAD));
  const cosHourAngle =
    (Math.sin(HORIZON * RAD) - Math.sin(latitude * RAD) * Math.sin(declination)) /
    (Math.cos(latitude * RAD) * Math.cos(declination));
  if (cosHourAngle < -1 || cosHourAngle > 1) {
    return {};
  }
  const hourAngle = Math.acos(cosHourAngle) / RAD;
  return {
    sunrise: fromJulian(transit - hourAngle / 360),
    sunset: fromJulian(transit + hourAngle / 360),
  };
}

/** Sun elevation above the horizon, in degrees, at an instant. */
export function sunElevation(instant, latitude, longitude) {
  const d = toJulian(new Date(instant).getTime()) - J2000;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const rightAscension = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / RAD;
  const declination = Math.asin(Math.sin(e) * Math.sin(l));
  const siderealHours = 18.697374558 + 24.06570982441908 * d;
  const hourAngle = (siderealHours * 15 + longitude - rightAscension) * RAD;
  const elevation = Math.asin(
    Math.sin(latitude * RAD) * Math.sin(declination) +
      Math.cos(latitude * RAD) * Math.cos(declination) * Math.cos(hourAngle),
  );
  return elevation / RAD;
}

export function isDaylight(instant, latitude, longitude) {
  return sunElevation(instant, latitude, longitude) > HORIZON;
}
