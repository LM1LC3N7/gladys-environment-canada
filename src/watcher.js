// -----------------------------------------------------------------------------
// Background loop: keeps the weather of the houses fresh and tells Gladys when
// something changed, instead of waiting for its 30-minute check.
//
// Every WATCH_INTERVAL (5 min), for each located house:
//   - forecasts: refreshed when older than SNAPSHOT_TTL (10 min);
//   - alerts: re-read; a changed set of alerts -> requestWeatherRefresh(), so
//     the core's "weather alert" scene trigger fires within minutes (the
//     core re-pulls through onWeatherGet, served from the fresh cache);
//   - feels-like and air quality levels: scene events on every crossed level;
//   - new data -> requestWidgetRefresh() for the widgets.
//
// The houses come from getHouses() (manifest `location: true`), re-read every
// 30 min since Gladys has no "house changed" event. Without them, the last
// location Gladys asked the weather for is watched.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  AIR_QUALITY_WIDGET,
  FEELS_LIKE_WIDGET,
  HOUSES_REFRESH_INTERVAL,
  WATCH_INTERVAL,
} from './constants.js';
import { isValidLocation, locationKey } from './geo.js';
import { assess } from './assessment.js';
import { AirQualityTracker, FeelsLikeTracker } from './sceneTriggers.js';

const defaultLogger = createLogger({ name: 'watcher' });

/** A signature of the alerts: changes when one appears, ends or changes level. */
export function alertsSignature(alerts) {
  return alerts
    .map((alert) => `${alert.id ?? alert.event.en}|${alert.severity}`)
    .sort()
    .join(';');
}

/** A signature of the air quality: changes with a new reading or forecast. */
export function airQualitySignature(airQuality) {
  if (!airQuality) {
    return 'none';
  }
  return `${airQuality.current?.datetime}|${airQuality.current?.value}|${airQuality.issued}`;
}

export class Watcher {
  /**
   * @param {{ gladys: object, provider: import('./provider.js').WeatherProvider,
   *   getPreferences: () => { language: string, units: string }, logger?: object,
   *   now?: () => number }} options
   */
  constructor({ gladys, provider, getPreferences, logger, now }) {
    this.gladys = gladys;
    this.provider = provider;
    this.getPreferences = getPreferences;
    this.logger = logger ?? defaultLogger;
    this.now = now ?? Date.now;
    this.tracker = new FeelsLikeTracker();
    this.airTracker = new AirQualityTracker();
    this.houses = [];
    this.housesReadAt = 0;
    this.signatures = new Map();
    this.airSignatures = new Map();
    this.fetchedAt = new Map();
    this.timer = undefined;
    this.running = false;
  }

  start() {
    this.stop();
    this.housesReadAt = 0;
    this.tick();
    this.timer = setInterval(() => this.tick(), WATCH_INTERVAL);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async refreshHouses() {
    try {
      const houses = await this.gladys.getHouses();
      this.houses = houses
        .filter((h) => isValidLocation(h.latitude, h.longitude))
        .map((h) => ({ ...h, key: h.selector ?? locationKey(h.latitude, h.longitude) }));
      if (this.houses[0]) {
        this.provider.setDefaultLocation({
          latitude: this.houses[0].latitude,
          longitude: this.houses[0].longitude,
        });
      }
    } catch (err) {
      // 403 when the location access was refused: keep the last location.
      this.logger.warn(`Cannot read the houses: ${err.message}`);
    }
    this.housesReadAt = this.now();
  }

  /** The places to watch: the located houses, or the last requested location. */
  locations() {
    if (this.houses.length > 0) {
      return this.houses;
    }
    const last = this.provider.lastLocation;
    return last ? [{ ...last, key: locationKey(last.latitude, last.longitude), name: '' }] : [];
  }

  /** Find a house by name or selector; the first one when `query` is empty. */
  findHouse(query) {
    const wanted = String(query ?? '')
      .trim()
      .toLowerCase();
    const all = this.locations();
    if (!wanted) {
      return all[0];
    }
    return all.find(
      (h) => h.selector?.toLowerCase() === wanted || h.name?.toLowerCase() === wanted,
    );
  }

  async tick() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      if (this.now() - this.housesReadAt >= HOUSES_REFRESH_INTERVAL) {
        await this.refreshHouses();
      }
      let alertsChanged = false;
      let dataChanged = false;
      let airChanged = false;
      for (const house of this.locations()) {
        const result = await this.watchHouse(house);
        alertsChanged ||= result.alertsChanged;
        dataChanged ||= result.dataChanged;
        airChanged ||= result.airChanged;
      }
      if (alertsChanged) {
        this.logger.info('Alerts changed -> asking Gladys to refresh the weather');
        this.gladys.requestWeatherRefresh();
      }
      if (alertsChanged || dataChanged) {
        this.gladys.requestWidgetRefresh(FEELS_LIKE_WIDGET);
      }
      if (airChanged) {
        this.gladys.requestWidgetRefresh(AIR_QUALITY_WIDGET);
      }
    } catch (err) {
      this.logger.error('Watch cycle failed', err);
    } finally {
      this.running = false;
    }
  }

  async watchHouse(house) {
    const { latitude, longitude, key } = house;
    const airQuality = await this.provider.getAirQuality(latitude, longitude);
    const airSignature = airQualitySignature(airQuality);
    const airChanged = airSignature !== this.airSignatures.get(key);
    this.airSignatures.set(key, airSignature);
    for (const event of this.airTracker.evaluate(house, airQuality, this.getPreferences())) {
      await this.publish(event);
    }

    let snapshot;
    try {
      snapshot = await this.provider.getSnapshot(latitude, longitude);
    } catch (err) {
      this.logger.warn(`No weather for ${house.name || key}: ${err.message}`);
      return { alertsChanged: false, dataChanged: false, airChanged };
    }
    const fetchedAt = this.provider.cachedSnapshot(latitude, longitude)?.fetchedAt;
    const dataChanged = fetchedAt !== this.fetchedAt.get(key);
    this.fetchedAt.set(key, fetchedAt);

    const official = await this.provider.getAlerts(latitude, longitude, { force: true });
    const signature = alertsSignature(this.provider.combineAlerts(snapshot, official, airQuality));
    const previous = this.signatures.get(key);
    this.signatures.set(key, signature);

    const events = this.tracker.evaluate(
      house,
      assess(snapshot, this.now()),
      this.getPreferences(),
    );
    for (const event of events) {
      await this.publish(event);
    }
    return {
      alertsChanged: previous !== undefined && previous !== signature,
      dataChanged,
      airChanged,
    };
  }

  // A refused event (429, 400) must never break the loop.
  async publish({ key, data }) {
    try {
      this.logger.info(`Scene event ${key}: ${data.previous_level} -> ${data.level}`);
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      this.logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }
}
