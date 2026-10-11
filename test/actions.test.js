import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../src/actions.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { FIXTURE_NOW, installFetch, json, montrealRoutes } from './helpers/fakeFetch.js';

let fake;
afterEach(() => fake?.restore());

const watcherAt = (house) => ({ findHouse: () => house });
const MONTREAL_HOUSE = { name: 'Maison', latitude: 45.5017, longitude: -73.5673 };

test('the test button reports every source', async () => {
  fake = installFetch(montrealRoutes());
  const { test_sources: run } = createActions({
    watcher: watcherAt(MONTREAL_HOUSE),
    getConfig: () => DEFAULT_CONFIG,
    now: () => FIXTURE_NOW,
  });
  const message = await run();
  assert.match(
    message.fr,
    /^Prévisions : OK \(Montréal, \d+ °C\) · Alertes : OK, 0 en cours · Qualité de l’air : OK \(Montréal, cote \d+\)$/,
  );
  assert.match(message.en, /Air quality: OK \(Montréal, AQHI \d+\)$/);
});

test('a failing source is reported, not thrown', async () => {
  fake = installFetch(
    montrealRoutes({ routes: [[/citypageweather|aqhi-stations/, () => json({}, 500)]] }),
  );
  const { test_sources: run } = createActions({
    watcher: watcherAt(MONTREAL_HOUSE),
    getConfig: () => ({ ...DEFAULT_CONFIG, official_alerts: false }),
  });
  assert.equal(
    (await run()).en,
    'Forecasts: failed (HTTP 500 on /collections/citypageweather-realtime/items) · ' +
      'Air quality: failed (HTTP 500 on /collections/aqhi-stations/items)',
  );
});

test('without a located house, the user is told what to do', async () => {
  fake = installFetch([]);
  const { test_sources: run } = createActions({ watcher: watcherAt(undefined) });
  assert.match((await run()).fr, /placez votre maison/);
});

test('outside Canada, nothing is asked', async () => {
  fake = installFetch(montrealRoutes());
  const { test_sources: run } = createActions({
    watcher: watcherAt({ latitude: 48.85, longitude: 2.35 }),
    getConfig: () => DEFAULT_CONFIG,
  });
  assert.match((await run()).en, /outside Canada/);
  assert.equal(fake.calls.length, 0);
});
