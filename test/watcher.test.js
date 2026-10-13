import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WeatherProvider } from '../src/provider.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { Watcher } from '../src/watcher.js';
import { AirQualityTracker, FeelsLikeTracker } from '../src/sceneTriggers.js';
import { INDEX_KINDS } from '../src/feelsLike.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  FIXTURE_NOW,
  MONTREAL,
  cityPageAt,
  fixture,
  installFetch,
  json,
  montrealRoutes,
} from './helpers/fakeFetch.js';

let fake;
afterEach(() => fake?.restore());

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const QUEBEC_HOUSE = {
  id: '1',
  name: 'Chalet',
  selector: 'chalet',
  latitude: 46.8,
  longitude: -70.8,
};
// The Montréal city page, moved next to the house of the tests.
const quebecRoutes = (options = {}) =>
  montrealRoutes({ city: cityPageAt({ at: QUEBEC_HOUSE }), ...options });

function setup({ houses = [QUEBEC_HOUSE], config = {} } = {}) {
  const clock = { now: FIXTURE_NOW };
  const gladys = createFakeGladys({ houses });
  const provider = new WeatherProvider({
    getConfig: () => ({ ...DEFAULT_CONFIG, ...config }),
    now: () => clock.now,
    logger: silent,
  });
  const watcher = new Watcher({
    gladys,
    provider,
    getPreferences: () => ({ language: 'fr', units: 'metric' }),
    logger: silent,
    now: () => clock.now,
  });
  return { gladys, provider, watcher, clock };
}

test('a new alert nudges Gladys; the first poll is only a baseline', async () => {
  let alerts = { type: 'FeatureCollection', features: [] };
  fake = installFetch([[/weather-alerts/, () => json(alerts)], ...quebecRoutes()]);
  const { gladys, watcher, clock } = setup();
  await watcher.tick();
  assert.equal(gladys.weatherRefreshes.length, 0);
  assert.deepEqual(
    gladys.widgetRefreshes,
    ['feels_like', 'air_quality'],
    'first data: widgets nudged',
  );

  alerts = fixture('eccc-alerts.json');
  clock.now += 5 * 60_000;
  await watcher.tick();
  assert.equal(gladys.weatherRefreshes.length, 1, 'frost advisory appeared');

  clock.now += 5 * 60_000;
  await watcher.tick();
  assert.equal(gladys.weatherRefreshes.length, 1, 'nothing changed');
});

test('the houses come from getHouses(); none located -> the last asked location', async () => {
  fake = installFetch(quebecRoutes());
  const { watcher, provider } = setup({ houses: [{ id: '2', name: 'Sans carte', selector: 'x' }] });
  await watcher.refreshHouses();
  assert.deepEqual(watcher.locations(), []);
  provider.lastLocation = { latitude: 45.5, longitude: -73.57 };
  assert.equal(watcher.locations().length, 1);
});

test('a refused location access does not break the loop', async () => {
  fake = installFetch(quebecRoutes());
  const { gladys, watcher } = setup();
  gladys.houses = new Error('403 Forbidden');
  await watcher.tick();
  assert.deepEqual(watcher.locations(), []);
});

test('houses are found by name or selector, case-insensitive', async () => {
  fake = installFetch(quebecRoutes());
  const { watcher } = setup({
    houses: [QUEBEC_HOUSE, { ...QUEBEC_HOUSE, name: 'Maison', selector: 'main-house' }],
  });
  await watcher.refreshHouses();
  assert.equal(watcher.findHouse('').name, 'Chalet');
  assert.equal(watcher.findHouse('maison').selector, 'main-house');
  assert.equal(watcher.findHouse('MAIN-HOUSE').name, 'Maison');
  assert.equal(watcher.findHouse('inconnue'), undefined);
});

const assessment = (kind, value) => ({ index: { kind, value } });

test('scene events: baseline first, then one event per crossed level', () => {
  const tracker = new FeelsLikeTracker();
  const house = { key: 'h', name: 'Maison' };
  const fr = { language: 'fr', units: 'metric' };
  assert.deepEqual(tracker.evaluate(house, assessment(INDEX_KINDS.WIND_CHILL, -5), fr), []);
  const events = tracker.evaluate(house, assessment(INDEX_KINDS.WIND_CHILL, -30), fr);
  assert.deepEqual(
    events.map((e) => [e.data.level, e.data.direction]),
    [
      ['cold_moderate', 'worsening'],
      ['cold_high', 'worsening'],
    ],
  );
  const [first] = events;
  assert.equal(first.key, 'feels_like_level_changed');
  assert.equal(first.data.current_level, 'cold_high');
  assert.equal(first.data.previous_level, 'comfortable');
  assert.equal(first.data.value, -30);
  assert.equal(first.data.unit, '°C');
  assert.equal(first.data.house, 'Maison');
  assert.match(first.data.summary, /^Refroidissement éolien −30°C : risque élevé \(froid\)\./);
  // Flat data of primitives (scene event contract).
  for (const value of Object.values(first.data)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value));
  }
  // Hovering on the threshold: no new event.
  assert.deepEqual(tracker.evaluate(house, assessment(INDEX_KINDS.WIND_CHILL, -27), fr), []);
});

test('scene events in °F for a user in us units; humidex keeps no unit', () => {
  const tracker = new FeelsLikeTracker();
  const house = { key: 'h' };
  const us = { language: 'en', units: 'us' };
  tracker.evaluate(house, assessment(INDEX_KINDS.WIND_CHILL, -5), us);
  const [event] = tracker.evaluate(house, assessment(INDEX_KINDS.WIND_CHILL, -12), us);
  assert.equal(event.data.value, 10); // -12 °C
  assert.equal(event.data.unit, '°F');
  const heat = new FeelsLikeTracker();
  heat.evaluate(house, assessment(INDEX_KINDS.HUMIDEX, 25), us);
  const [hot] = heat.evaluate(house, assessment(INDEX_KINDS.HUMIDEX, 41), us);
  assert.equal(hot.data.value, 41);
  assert.equal(hot.data.unit, '');
});

test('the watcher publishes the scene events, and survives a refusal', async () => {
  const conditions = { temperature: 4.6, wind: 6 };
  const city = () =>
    cityPageAt({
      at: QUEBEC_HOUSE,
      edit: ({ currentConditions: cc }) => {
        cc.temperature.value = { en: conditions.temperature, fr: conditions.temperature };
        cc.wind.speed.value = { en: conditions.wind, fr: conditions.wind };
      },
    });
  fake = installFetch([
    [
      /citypageweather-realtime\/items\?/,
      () => json({ type: 'FeatureCollection', features: [city()] }),
    ],
    [/citypageweather-realtime\/items\//, () => json(city())],
    ...montrealRoutes(),
  ]);
  const { gladys, watcher, provider, clock } = setup();
  await watcher.tick();
  assert.equal(gladys.sceneEvents.length, 0, 'baseline');
  Object.assign(conditions, { temperature: -30, wind: 40 });
  provider.clear();
  clock.now += 11 * 60_000;
  gladys.rejectSceneEvents = true;
  await watcher.tick();
  gladys.rejectSceneEvents = false;
  conditions.temperature = -40;
  provider.clear();
  clock.now += 11 * 60_000;
  await watcher.tick();
  assert.ok(gladys.sceneEvents.length > 0);
  assert.equal(gladys.sceneEvents.at(-1).data.current_level, 'cold_extreme');
});

const air = (value, name = { en: 'Montréal', fr: 'Montréal' }) => ({
  station: { id: 'EHHUN', name, distanceKm: 3 },
  current: { value, datetime: '2026-10-10T12:00:00.000Z', observed: true },
});

test('air quality events: baseline, crossed levels, hysteresis', () => {
  const tracker = new AirQualityTracker();
  const house = { key: 'h', name: 'Maison' };
  const fr = { language: 'fr' };
  assert.deepEqual(tracker.evaluate(house, air(2.4), fr), [], 'baseline');
  assert.deepEqual(tracker.evaluate(house, undefined, fr), [], 'no index: nothing');
  const events = tracker.evaluate(house, air(7.2), fr);
  assert.deepEqual(
    events.map((e) => [e.key, e.data.level, e.data.direction]),
    [
      ['air_quality_level_changed', 'moderate', 'worsening'],
      ['air_quality_level_changed', 'high', 'worsening'],
    ],
  );
  const [first] = events;
  assert.equal(first.data.value, 7);
  assert.equal(first.data.previous_level, 'low');
  assert.equal(first.data.current_level, 'high');
  assert.equal(first.data.station, 'Montréal');
  assert.match(first.data.summary, /^Cote air santé 7 : risque élevé\. /);
  for (const value of Object.values(first.data)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value));
  }
  assert.deepEqual(tracker.evaluate(house, air(6.4), fr), [], 'a 6 stays high (hysteresis)');
  const better = tracker.evaluate(house, air(5), { language: 'en' });
  assert.deepEqual(
    better.map((e) => [e.data.level, e.data.direction]),
    [['moderate', 'improving']],
  );
  assert.match(better[0].data.summary, /^Air Quality Health Index 5: moderate risk\./);
});

test('the watcher fires the air quality events of a house', async () => {
  const forecasts = fixture('eccc-aqhi-forecasts-montreal.json');
  let value = 2;
  fake = installFetch([
    [
      /aqhi-forecasts/,
      () => {
        for (const feature of forecasts.features) {
          if (Number.isFinite(feature.properties.aqhi)) {
            feature.properties.aqhi = value;
          }
        }
        return json(forecasts);
      },
    ],
    ...montrealRoutes(),
  ]);
  const { gladys, watcher, clock } = setup({
    houses: [{ id: '2', name: 'Maison', selector: 'maison', ...MONTREAL }],
  });
  await watcher.tick();
  assert.equal(gladys.sceneEvents.length, 0, 'baseline');
  value = 11;
  clock.now += 16 * 60_000;
  await watcher.tick();
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.data.level),
    ['moderate', 'high', 'very_high'],
  );
  assert.equal(gladys.widgetRefreshes.filter((k) => k === 'air_quality').length, 2);
});

test('alert events: baseline, then issued and ended, kept in the store', async () => {
  const { createMemoryStore } = await import('../src/store.js');
  const store = createMemoryStore();
  let alerts = { type: 'FeatureCollection', features: [] };
  fake = installFetch([[/weather-alerts/, () => json(alerts)], ...quebecRoutes()]);
  const clock = { now: FIXTURE_NOW };
  const gladys = createFakeGladys({ houses: [QUEBEC_HOUSE] });
  const provider = new WeatherProvider({ now: () => clock.now, logger: silent });
  const watcher = new Watcher({
    gladys,
    provider,
    getPreferences: () => ({ language: 'fr', units: 'metric' }),
    store,
    logger: silent,
    now: () => clock.now,
  });
  await watcher.tick();
  assert.deepEqual(gladys.sceneEvents, []);
  assert.deepEqual(JSON.parse(store.files.get('alerts.json')).areas, { chalet: { kinds: {} } });
  // The frost advisory appears.
  alerts = fixture('eccc-alerts.json');
  clock.now += 5 * 60_000;
  await watcher.tick();
  assert.deepEqual(
    gladys.sceneEvents.map((e) => [e.key, e.data.type, e.data.level, e.data.house]),
    [['alert_issued', 'cold', 2, 'Chalet']],
  );
  assert.equal(gladys.sceneEvents[0].data.title, 'Avis de gel (niveau 2)');
  assert.equal(JSON.parse(store.files.get('alerts.json')).areas.chalet.kinds.cold.level, 2);
  assert.ok(gladys.widgetRefreshes.includes('alerts'));
  // Gone after its end time, read after it: ended.
  alerts = { type: 'FeatureCollection', features: [] };
  clock.now = Date.parse('2026-10-11T15:00:00Z');
  await watcher.tick();
  assert.equal(gladys.sceneEvents.at(-1).key, 'alert_ended');
  assert.deepEqual(JSON.parse(store.files.get('alerts.json')).areas.chalet.kinds, {});
  // The scene action summary and the houses it names.
  const { createSceneActions } = await import('../src/scenes.js');
  const actions = createSceneActions({
    watcher,
    provider,
    getPreferences: () => ({ language: 'en' }),
    now: () => clock.now,
  });
  const result = await actions.get_alerts({ house: 'Chalet' });
  assert.equal(result.count, 0);
  assert.match(result.summary, /Chalet: no weather alert/);
  assert.equal(
    (await actions.get_alerts({ house: 'Nowhere' })).summary.startsWith('No located'),
    true,
  );
});
