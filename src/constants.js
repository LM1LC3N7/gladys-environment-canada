// -----------------------------------------------------------------------------
// Shared constants: endpoints, timeouts, cache durations.
//
// Every duration is in milliseconds unless the name says otherwise.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;

// Identifiable User-Agent: let ECCC know who calls its API and where to reach
// the maintainers.
export const USER_AGENT = `gladys-environment-canada/${VERSION} (+https://github.com/LM1LC3N7/gladys-environment-canada)`;

export const ECCC_API_URL = 'https://api.weather.gc.ca';
export const ECCC_GEOMET_URL = 'https://geo.weather.gc.ca/geomet';
// Natural Resources Canada base map (Open Government Licence - Canada).
export const NRCAN_BASEMAP_URL = 'https://maps.geogratis.gc.ca/wms/CBMT';

// Gladys awaits onWeatherGet under 15 s: the city page lookup (two calls at
// most) and the alerts must fit, with margin.
export const HTTP_TIMEOUT = 5_000;

// Forecast data: at least 10 minutes between two calls for one location.
export const SNAPSHOT_TTL = 10 * 60 * 1000;
// Served when every source fails, rather than nothing.
export const SNAPSHOT_STALE_MAX_AGE = 3 * 60 * 60 * 1000;
export const ALERTS_TTL = 5 * 60 * 1000;
export const ALERTS_STALE_MAX_AGE = 60 * 60 * 1000;
// The nearest ECCC city page or AQHI community of a location never moves.
export const CITY_LOOKUP_TTL = 24 * 60 * 60 * 1000;
// AQHI observations are hourly, forecasts twice a day.
export const AIR_QUALITY_TTL = 15 * 60 * 1000;
export const AIR_QUALITY_STALE_MAX_AGE = 3 * 60 * 60 * 1000;
export const RADAR_TTL = 5 * 60 * 1000;

// Background loop: alerts every tick, forecasts when older than SNAPSHOT_TTL.
export const WATCH_INTERVAL = 5 * 60 * 1000;
// Gladys has no "house changed" event: re-read the houses regularly.
export const HOUSES_REFRESH_INTERVAL = 30 * 60 * 1000;

// Cache entries kept per kind (locations are rounded, a few houses at most).
export const MAX_CACHE_ENTRIES = 20;

// Pivot limits (contract B.18).
export const MAX_HOURS = 24;
export const MAX_DAYS = 8;
export const MAX_ALERTS = 10;
export const MAX_ALERT_EVENT_LENGTH = 100;
export const MAX_ALERT_DESCRIPTION_LENGTH = 5000;

export const RADAR_IMAGE_KEY = 'radar';
export const FEELS_LIKE_WIDGET = 'feels_like';
export const FEELS_LIKE_TRIGGER = 'feels_like_level_changed';
export const AIR_QUALITY_WIDGET = 'air_quality';
export const AIR_QUALITY_TRIGGER = 'air_quality_level_changed';
export const ALERT_ISSUED_TRIGGER = 'alert_issued';
export const ALERT_ENDED_TRIGGER = 'alert_ended';
export const GET_ALERTS_ACTION = 'get_alerts';
export const ALERTS_WIDGET = 'alerts';
// The alerts widget tiles "now" and "later" move when an alert starts:
// re-read the cached alerts every minute, without network.
export const CLOCK_INTERVAL = 60 * 1000;
