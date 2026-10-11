import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aqhiLevelOf,
  aqhiLevelWithHysteresis,
  crossedAqhiLevels,
  formatAqhi,
  roundAqhi,
} from '../src/aqhi.js';
import {
  MAX_STATION_DISTANCE_KM,
  buildAirQuality,
  fetchAirQuality,
  findNearestStation,
  parseForecast,
  parseObservation,
} from '../src/sources/ecccAqhi.js';
import { FIXTURE_NOW, fixture, installFetch, json, montrealRoutes } from './helpers/fakeFetch.js';

let fake;
afterEach(() => fake?.restore());

test('the AQHI is read as an integer, "10+" above 10', () => {
  assert.equal(roundAqhi(2.12), 2);
  assert.equal(roundAqhi(0.4), 1, 'the scale starts at 1');
  assert.equal(roundAqhi(undefined), undefined);
  assert.equal(formatAqhi(10.4), '10');
  assert.equal(formatAqhi(10.6), '10+');
  assert.equal(formatAqhi(null), '–');
});

test('the four risk levels of Health Canada', () => {
  assert.deepEqual([1, 3, 4, 6, 7, 10, 11, 15].map(aqhiLevelOf), [
    'low',
    'low',
    'moderate',
    'moderate',
    'high',
    'high',
    'very_high',
    'very_high',
  ]);
  assert.equal(aqhiLevelOf(3.4), 'low');
  assert.equal(aqhiLevelOf(3.5), 'moderate');
});

test('leaving a level downwards needs a 1-unit margin', () => {
  assert.equal(aqhiLevelWithHysteresis(6, 'high'), 'high');
  assert.equal(aqhiLevelWithHysteresis(5, 'high'), 'moderate');
  assert.equal(aqhiLevelWithHysteresis(7, 'moderate'), 'high', 'rising has no margin');
  assert.equal(aqhiLevelWithHysteresis(2, undefined), 'low');
});

test('every crossed level, in order', () => {
  assert.deepEqual(crossedAqhiLevels('low', 'very_high'), [
    { level: 'moderate', direction: 'worsening' },
    { level: 'high', direction: 'worsening' },
    { level: 'very_high', direction: 'worsening' },
  ]);
  assert.deepEqual(crossedAqhiLevels('high', 'low'), [
    { level: 'moderate', direction: 'improving' },
    { level: 'low', direction: 'improving' },
  ]);
  assert.deepEqual(crossedAqhiLevels('low', 'low'), []);
});

test('a recent observation is kept, an old one is not', () => {
  const body = fixture('eccc-aqhi-observations-toronto.json');
  const observed = parseObservation(body, FIXTURE_NOW);
  assert.equal(observed.value, 2.12);
  assert.equal(observed.datetime, '2026-10-10T11:00:00.000Z');
  assert.equal(observed.notes, undefined);
  assert.equal(parseObservation(body, FIXTURE_NOW + 4 * 3_600_000), undefined);
  assert.equal(parseObservation(fixture('eccc-aqhi-observations-montreal.json')), undefined);
});

test('the latest forecast: hours from now on, named periods', () => {
  const forecast = parseForecast(fixture('eccc-aqhi-forecasts-montreal.json'), FIXTURE_NOW);
  assert.equal(forecast.issued, '2026-10-10T10:00:00.000Z');
  assert.ok(forecast.hours.length > 20);
  assert.ok(Date.parse(forecast.hours[0].datetime) > FIXTURE_NOW - 3_600_000);
  for (let i = 1; i < forecast.hours.length; i += 1) {
    assert.ok(forecast.hours[i].datetime > forecast.hours[i - 1].datetime);
  }
  assert.deepEqual(
    forecast.periods.map((p) => p.name.fr),
    ['Ce soir et cette nuit', 'Demain', 'Demain soir et nuit', 'Jour 3'],
  );
  assert.equal(forecast.periods[0].smoke, undefined);
  assert.equal(parseForecast({ features: [] }), undefined);
});

test('without an observation, the current value is the forecast of this hour', () => {
  const station = { id: 'EHHUN', name: { en: 'Montréal', fr: 'Montréal' }, distanceKm: 3 };
  const forecast = parseForecast(fixture('eccc-aqhi-forecasts-montreal.json'), FIXTURE_NOW);
  const air = buildAirQuality(station, undefined, forecast, FIXTURE_NOW);
  assert.equal(air.current.observed, false);
  assert.ok(Number.isFinite(air.current.value));
  assert.ok(air.hours.length <= 25);
  assert.ok(air.hours.every((h) => h.value <= air.peak.value));
  assert.equal(buildAirQuality(station, undefined, undefined, FIXTURE_NOW), undefined);
});

test('the nearest community within reach', async () => {
  fake = installFetch(montrealRoutes());
  const station = await findNearestStation(45.5017, -73.5673);
  assert.equal(station.id, 'EHHUN');
  assert.deepEqual(station.name, { en: 'Montréal', fr: 'Montréal' });
  assert.ok(station.distanceKm < MAX_STATION_DISTANCE_KM);
  // The Montréal community seen from Trois-Rivières (about 130 km).
  assert.equal(await findNearestStation(46.35, -72.55), undefined);
});

test('the observations and the forecasts are read in parallel, one may fail', async () => {
  fake = installFetch([
    [/aqhi-observations/, () => json({}, 500)],
    [/aqhi-forecasts/, () => json(fixture('eccc-aqhi-forecasts-toronto.json'))],
  ]);
  const station = { id: 'FDQBU', name: { en: 'Toronto East', fr: 'Toronto Est' }, distanceKm: 1 };
  const air = await fetchAirQuality(station, { now: FIXTURE_NOW });
  assert.equal(air.current.observed, false);
  assert.match(fake.calls[1].url, /location_id=FDQBU&sortby=-publication_datetime&limit=80$/);
  fake.restore();
  fake = installFetch([[/aqhi/, () => json({}, 503)]]);
  await assert.rejects(fetchAirQuality(station, { now: FIXTURE_NOW }), /HTTP 503/);
});
