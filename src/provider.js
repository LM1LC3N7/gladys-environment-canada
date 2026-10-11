// -----------------------------------------------------------------------------
// The weather provider: caches, sources, alerts, air quality, images.
//
//   getSnapshot    the nearest ECCC city page (current conditions, 24 hours,
//                  about 6 days); the last good snapshot (≤ 3 h) when it
//                  fails. Cached 10 minutes per location.
//   getAlerts      official ECCC alerts, cached 5 minutes.
//   getAirQuality  the AQHI of the nearest community, cached 15 minutes.
//   getWeather     the onWeatherGet answer, in the pivot format.
//   getImage       the onWeatherGetImage answer (radar).
//
// Concurrent requests for one location share the same in-flight promise:
// the dashboard, the chat and the background loop never multiply the calls.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  AIR_QUALITY_STALE_MAX_AGE,
  AIR_QUALITY_TTL,
  ALERTS_STALE_MAX_AGE,
  ALERTS_TTL,
  CITY_LOOKUP_TTL,
  HTTP_TIMEOUT,
  MAX_CACHE_ENTRIES,
  RADAR_IMAGE_KEY,
  RADAR_TTL,
  SNAPSHOT_STALE_MAX_AGE,
  SNAPSHOT_TTL,
} from './constants.js';
import { DEFAULT_CONFIG } from './config.js';
import { isInCanadaArea, isValidLocation, locationKey } from './geo.js';
import { airQualityAlerts, assess, syntheticAlerts } from './assessment.js';
import { toPivot } from './pivot.js';
import { num } from './units.js';
import { fetchCityPage, findNearestCity, parseCityPage } from './sources/ecccCitypage.js';
import { fetchAlerts } from './sources/ecccAlerts.js';
import { fetchAirQuality, findNearestStation } from './sources/ecccAqhi.js';
import { buildRadarImage } from './sources/ecccRadar.js';

const defaultLogger = createLogger({ name: 'provider' });

export const RADAR_IMAGE = {
  key: RADAR_IMAGE_KEY,
  label: { en: 'Precipitation radar', fr: 'Radar de précipitations' },
};

export class OutsideCanadaError extends Error {
  constructor() {
    super('Environment Canada only covers Canada: this house is outside');
    this.name = 'OutsideCanadaError';
  }
}

/** Map with a bounded size: the oldest inserted entry goes first. */
class BoundedMap extends Map {
  set(key, value) {
    this.delete(key);
    super.set(key, value);
    if (this.size > MAX_CACHE_ENTRIES) {
      this.delete(this.keys().next().value);
    }
    return this;
  }
}

export class WeatherProvider {
  /**
   * @param {{ getConfig?: () => object, logger?: object, now?: () => number,
   *   onStatus?: (status: { ok: boolean, source?: string, error?: Error }) => void }} options
   */
  constructor({ getConfig, logger, now, onStatus } = {}) {
    this.getConfig = getConfig ?? (() => DEFAULT_CONFIG);
    this.logger = logger ?? defaultLogger;
    this.now = now ?? Date.now;
    this.onStatus = onStatus ?? (() => {});
    this.snapshots = new BoundedMap();
    this.alerts = new BoundedMap();
    this.airQuality = new BoundedMap();
    this.cities = new BoundedMap();
    this.stations = new BoundedMap();
    this.inflight = new Map();
    this.radar = undefined;
    this.lastLocation = undefined;
  }

  /** Forget every cached value (config change). */
  clear() {
    this.snapshots.clear();
    this.alerts.clear();
    this.airQuality.clear();
    this.radar = undefined;
  }

  // One shared promise per (kind, location) while a fetch runs.
  share(id, factory) {
    if (!this.inflight.has(id)) {
      const promise = factory().finally(() => this.inflight.delete(id));
      this.inflight.set(id, promise);
    }
    return this.inflight.get(id);
  }

  async fetchCity(latitude, longitude) {
    const key = locationKey(latitude, longitude);
    const city = this.cities.get(key);
    let feature;
    if (city && this.now() - city.fetchedAt < CITY_LOOKUP_TTL) {
      feature = await fetchCityPage(city.id, { timeout: HTTP_TIMEOUT });
    } else {
      feature = await findNearestCity(latitude, longitude, { timeout: HTTP_TIMEOUT });
      this.cities.set(key, { id: feature.id, fetchedAt: this.now() });
    }
    return parseCityPage(feature, latitude, longitude, this.now());
  }

  /** The cached snapshot of a location, without fetching. */
  cachedSnapshot(latitude, longitude) {
    return this.snapshots.get(locationKey(latitude, longitude));
  }

  async getSnapshot(latitude, longitude, { force = false } = {}) {
    if (!isInCanadaArea(latitude, longitude)) {
      const error = new OutsideCanadaError();
      this.onStatus({ ok: false, error });
      throw error;
    }
    const key = locationKey(latitude, longitude);
    const cached = this.snapshots.get(key);
    if (!force && cached && this.now() - cached.fetchedAt < SNAPSHOT_TTL) {
      return cached.snapshot;
    }
    return this.share(`snapshot:${key}`, () => this.refreshSnapshot(latitude, longitude, cached));
  }

  async refreshSnapshot(latitude, longitude, cached) {
    try {
      const snapshot = await this.fetchCity(latitude, longitude);
      this.snapshots.set(locationKey(latitude, longitude), { snapshot, fetchedAt: this.now() });
      this.onStatus({ ok: true, source: snapshot.source });
      return snapshot;
    } catch (err) {
      this.logger.warn(`Environment Canada city page failed: ${err.message}`);
      this.onStatus({ ok: false, error: err });
      if (cached && this.now() - cached.fetchedAt < SNAPSHOT_STALE_MAX_AGE) {
        this.logger.warn('Serving the last known weather');
        return cached.snapshot;
      }
      throw err;
    }
  }

  /** Official ECCC alerts at a location (empty when disabled or abroad). */
  async getAlerts(latitude, longitude, { force = false } = {}) {
    if (!this.getConfig().official_alerts || !isInCanadaArea(latitude, longitude)) {
      return [];
    }
    const key = locationKey(latitude, longitude);
    const cached = this.alerts.get(key);
    if (!force && cached && this.now() - cached.fetchedAt < ALERTS_TTL) {
      return cached.alerts;
    }
    return this.share(`alerts:${key}`, async () => {
      try {
        const alerts = await fetchAlerts(latitude, longitude, {
          timeout: HTTP_TIMEOUT,
          now: this.now(),
        });
        this.alerts.set(key, { alerts, fetchedAt: this.now() });
        return alerts;
      } catch (err) {
        this.logger.warn(`ECCC alerts failed: ${err.message}`);
        // An alert must not vanish because of one failed call.
        if (cached && this.now() - cached.fetchedAt < ALERTS_STALE_MAX_AGE) {
          return cached.alerts;
        }
        return [];
      }
    });
  }

  /** The nearest AQHI community (or null when none is close enough), cached. */
  async findStation(latitude, longitude) {
    const key = locationKey(latitude, longitude);
    const known = this.stations.get(key);
    if (known && this.now() - known.fetchedAt < CITY_LOOKUP_TTL) {
      return known.station;
    }
    const station =
      (await findNearestStation(latitude, longitude, { timeout: HTTP_TIMEOUT })) ?? null;
    this.stations.set(key, { station, fetchedAt: this.now() });
    return station;
  }

  /**
   * The air quality at a location: undefined when no AQHI community is
   * close enough, or when ECCC does not answer and nothing recent is known.
   */
  async getAirQuality(latitude, longitude, { force = false } = {}) {
    if (!isInCanadaArea(latitude, longitude)) {
      return undefined;
    }
    const key = locationKey(latitude, longitude);
    const cached = this.airQuality.get(key);
    if (!force && cached && this.now() - cached.fetchedAt < AIR_QUALITY_TTL) {
      return cached.airQuality;
    }
    return this.share(`air:${key}`, async () => {
      try {
        const station = await this.findStation(latitude, longitude);
        const airQuality = station
          ? await fetchAirQuality(station, { timeout: HTTP_TIMEOUT, now: this.now() })
          : undefined;
        this.airQuality.set(key, { airQuality, fetchedAt: this.now() });
        return airQuality;
      } catch (err) {
        this.logger.warn(`ECCC air quality failed: ${err.message}`);
        if (cached && this.now() - cached.fetchedAt < AIR_QUALITY_STALE_MAX_AGE) {
          return cached.airQuality;
        }
        return undefined;
      }
    });
  }

  /** Official alerts plus, when enabled, the feels-like and air quality ones. */
  combineAlerts(snapshot, official, airQuality) {
    const config = this.getConfig();
    const feelsLike = config.feels_like_alerts ? syntheticAlerts(assess(snapshot, this.now())) : [];
    const air = config.air_quality_alerts ? airQualityAlerts(airQuality) : [];
    return [...official, ...air, ...feelsLike];
  }

  images(latitude, longitude) {
    return this.getConfig().radar_image && isInCanadaArea(latitude, longitude) ? [RADAR_IMAGE] : [];
  }

  /** onWeatherGet: the pivot weather of a location. */
  async getWeather({ latitude, longitude, language, units }) {
    // num(): null and '' are not 0 (the middle of the Atlantic).
    const lat = num(latitude);
    const lon = num(longitude);
    if (!isValidLocation(lat, lon)) {
      throw new Error('The house has no valid coordinates');
    }
    this.lastLocation = { latitude: lat, longitude: lon };
    const [snapshot, official, airQuality] = await Promise.all([
      this.getSnapshot(lat, lon),
      this.getAlerts(lat, lon),
      this.getConfig().air_quality_alerts ? this.getAirQuality(lat, lon) : undefined,
    ]);
    return toPivot(snapshot, {
      latitude: lat,
      longitude: lon,
      units,
      language,
      alerts: this.combineAlerts(snapshot, official, airQuality),
      images: this.images(lat, lon),
      now: this.now(),
    });
  }

  /** Location used when Gladys has not asked for the weather yet. */
  setDefaultLocation(location) {
    this.lastLocation ??= location;
  }

  /**
   * onWeatherGetImage: images are instance-global in Gladys (no coordinates
   * in the request): the radar of the last location asked for.
   */
  async getImage(key) {
    if (key !== RADAR_IMAGE_KEY || !this.getConfig().radar_image) {
      throw new Error(`Unknown image "${key}"`);
    }
    if (!this.lastLocation) {
      throw new Error('No location known yet');
    }
    const { latitude, longitude } = this.lastLocation;
    const locKey = locationKey(latitude, longitude);
    if (this.radar?.key === locKey && this.now() - this.radar.fetchedAt < RADAR_TTL) {
      return this.radar.base64;
    }
    return this.share(`radar:${locKey}`, async () => {
      const base64 = await buildRadarImage(latitude, longitude, { timeout: HTTP_TIMEOUT });
      this.radar = { key: locKey, base64, fetchedAt: this.now() };
      return base64;
    });
  }
}
