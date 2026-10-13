// -----------------------------------------------------------------------------
// Background loop: keeps the weather of the houses fresh and tells Gladys when
// something changed, instead of waiting for its 30-minute check.
//
// Every WATCH_INTERVAL (5 min), for each located house:
//   - forecasts: refreshed when older than SNAPSHOT_TTL (10 min);
//   - alerts: re-read; a changed set of alerts -> requestWeatherRefresh(), so
//     the core's "weather alert" scene trigger fires within minutes (the
//     core re-pulls through onWeatherGet, served from the fresh cache);
//     "alert issued" / "alert ended" scene events (src/alertTracker.js, the
//     memory in /data);
//   - feels-like and air quality levels: scene events on every crossed level;
//   - new data -> requestWidgetRefresh() for the widgets.
//
// Every minute, without network, the cached alerts are re-read: an alert
// announced for 14:00 is "now" at 14:00 in the alerts widget.
//
// The houses come from getHouses() (manifest `location: true`), re-read every
// 30 min since Gladys has no "house changed" event. Without them, the last
// location Gladys asked the weather for is watched. House coordinates are
// never written to /data.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  AIR_QUALITY_WIDGET,
  ALERTS_WIDGET,
  CLOCK_INTERVAL,
  FEELS_LIKE_WIDGET,
  HOUSES_REFRESH_INTERVAL,
  WATCH_INTERVAL,
} from './constants.js';
import { isInCanadaArea, isValidLocation, locationKey } from './geo.js';
import { assess } from './assessment.js';
import { AirQualityTracker, FeelsLikeTracker } from './sceneTriggers.js';
import { AlertTracker } from './alertTracker.js';
import { inForce } from './sources/ecccAlerts.js';
import { timeZoneOf } from './timezone.js';

const defaultLogger = createLogger({ name: 'watcher' });

/** A signature of the alerts: changes when one appears, ends or changes level. */
export function alertsSignature(alerts) {
  return alerts
    .map((alert) => `${alert.id ?? alert.event.en}|${alert.severity}`)
    .sort()
    .join(';');
}

/** A signature of what the alerts widget shows: in force / upcoming ids. */
export function widgetSignature(alerts, now) {
  return alerts.map((a) => `${a.id}:${inForce(a, now) ? 1 : 0}`).join(';');
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
  constructor({ gladys, provider, getPreferences, store, logger, now }) {
    this.gladys = gladys;
    this.provider = provider;
    this.getPreferences = getPreferences;
    this.logger = logger ?? defaultLogger;
    this.now = now ?? Date.now;
    this.tracker = new FeelsLikeTracker();
    this.airTracker = new AirQualityTracker();
    this.alertTracker = new AlertTracker({ store, now: this.now });
    this.houses = [];
    this.housesReadAt = 0;
    this.signatures = new Map();
    this.widgetSignatures = new Map();
    this.airSignatures = new Map();
    this.fetchedAt = new Map();
    this.timer = undefined;
    this.clock = undefined;
    this.running = false;
  }

  start() {
    this.stop();
    this.housesReadAt = 0;
    this.tick();
    this.timer = setInterval(() => this.tick(), WATCH_INTERVAL);
    this.timer.unref?.();
    this.clock = setInterval(() => this.clockTick(), CLOCK_INTERVAL);
    this.clock.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.clock);
    this.timer = undefined;
    this.clock = undefined;
  }

  /** The IANA zone of a house: from its city page when known, else Eastern. */
  timeZoneOfHouse(house) {
    const cityId = this.provider.cachedSnapshot(house.latitude, house.longitude)?.snapshot.cityId;
    const province = String(cityId ?? '').split('-')[0];
    return (province && timeZoneOf(province, house.latitude, house.longitude)) || 'America/Toronto';
  }

  /** The houses a scene field names: one, or all located ones when empty. */
  housesFor(query) {
    if (!String(query ?? '').trim()) {
      return this.locations();
    }
    const house = this.findHouse(query);
    return house ? [house] : [];
  }

  /** Every minute: an alert that started or ended on the clock moves the widget. */
  clockTick() {
    let changed = false;
    for (const house of this.locations()) {
      const alerts = this.provider.cachedAlerts(house.latitude, house.longitude);
      if (!alerts) {
        continue;
      }
      const signature = widgetSignature(alerts, this.now());
      if (
        this.widgetSignatures.has(house.key) &&
        this.widgetSignatures.get(house.key) !== signature
      ) {
        changed = true;
      }
      this.widgetSignatures.set(house.key, signature);
    }
    if (changed) {
      this.gladys.requestWidgetRefresh(ALERTS_WIDGET);
    }
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
      let widgetChanged = false;
      let dataChanged = false;
      let airChanged = false;
      const houses = this.locations();
      for (const house of houses) {
        const result = await this.watchHouse(house);
        alertsChanged ||= result.alertsChanged;
        widgetChanged ||= result.widgetChanged;
        dataChanged ||= result.dataChanged;
        airChanged ||= result.airChanged;
      }
      this.alertTracker.keepOnly(houses.map((h) => h.key));
      if (alertsChanged) {
        this.logger.info('Alerts changed -> asking Gladys to refresh the weather');
        this.gladys.requestWeatherRefresh();
      }
      if (alertsChanged || widgetChanged) {
        this.gladys.requestWidgetRefresh(ALERTS_WIDGET);
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
      return { alertsChanged: false, widgetChanged: false, dataChanged: false, airChanged };
    }
    const fetchedAt = this.provider.cachedSnapshot(latitude, longitude)?.fetchedAt;
    const dataChanged = fetchedAt !== this.fetchedAt.get(key);
    this.fetchedAt.set(key, fetchedAt);

    const official = await this.provider.getAlerts(latitude, longitude, { force: true });
    const signature = alertsSignature(this.provider.combineAlerts(snapshot, official, airQuality));
    const previous = this.signatures.get(key);
    this.signatures.set(key, signature);
    const shown = widgetSignature(official, this.now());
    const widgetChanged =
      this.widgetSignatures.has(key) && this.widgetSignatures.get(key) !== shown;
    this.widgetSignatures.set(key, shown);
    // Nothing fresh from ECCC (a cached answer served on a failure, or no
    // alerts abroad): no alert event, the next successful read will tell.
    if (official.fetchedAt > 0 && isInCanadaArea(latitude, longitude)) {
      const area = { ...house, timeZone: this.timeZoneOfHouse(house) };
      const events = this.alertTracker.evaluate(
        area,
        official,
        official.fetchedAt,
        this.getPreferences(),
      );
      for (const event of events) {
        if (await this.publish(event)) {
          event.commit();
        }
      }
    }

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
      widgetChanged,
      dataChanged,
      airChanged,
    };
  }

  // A refused event (429, 400) must never break the loop.
  async publish({ key, data }) {
    try {
      this.logger.info(`Scene event ${key}: ${data.summary ?? data.title ?? data.level}`);
      await this.gladys.publishSceneEvent(key, data);
      return true;
    } catch (err) {
      this.logger.warn(`Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }
}
