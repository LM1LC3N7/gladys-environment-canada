import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  aqhiColor,
  buildAirQualityContent,
  buildFeelsLikeContent,
  createWidgets,
  levelColor,
} from '../src/widgets.js';
import { WeatherProvider } from '../src/provider.js';
import { Watcher } from '../src/watcher.js';
import { parseCityPage } from '../src/sources/ecccCitypage.js';
import { buildAirQuality, parseForecast, parseObservation } from '../src/sources/ecccAqhi.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  FIXTURE_NOW,
  MONTREAL,
  fixture,
  installFetch,
  json,
  montrealRoutes,
} from './helpers/fakeFetch.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

let fake;
afterEach(() => fake?.restore());

const load = () =>
  parseCityPage(
    fixture('eccc-citypage-montreal.json'),
    MONTREAL.latitude,
    MONTREAL.longitude,
    FIXTURE_NOW,
  );

// A hot, humid afternoon derived from the Montréal fixture.
function heatWave() {
  const snapshot = load();
  const warm = (h) => ({ ...h, temperature: h.temperature + 24, dew_point: 22, is_day: h.is_day });
  return {
    ...snapshot,
    current: { ...warm(snapshot.current), apparent_temperature: 38 },
    hours: snapshot.hours.map(warm),
  };
}

// A cold snap with freezing rain derived from the Montréal fixture.
function coldSnap() {
  const snapshot = load();
  return {
    ...snapshot,
    current: { ...snapshot.current, temperature: -32, wind_speed: 30 / 3.6, wind_gust: 60 / 3.6 },
    hours: snapshot.hours.map((h, i) =>
      i === 3 ? { ...h, temperature: -1, weather: 'freezing-rain', rain: 1, precipitation: 1 } : h,
    ),
  };
}

const cases = {
  'Montréal (mild)': load(),
  'heat wave': heatWave(),
  'cold snap': coldSnap(),
};

for (const [name, snapshot] of Object.entries(cases)) {
  for (const units of ['metric', 'us']) {
    test(`the widget content is rendered exactly as sent: ${name}, ${units}`, () => {
      const content = buildFeelsLikeContent(snapshot, { units, now: FIXTURE_NOW });
      assert.deepEqual(validateWidgetContent(content), []);
    });
  }
}

test('heat: humidex heading, dew point tile, muggy night', () => {
  const content = buildFeelsLikeContent(heatWave(), { units: 'metric', now: FIXTURE_NOW });
  assert.match(content.components[0].text.fr, /^Humidex \d+$/);
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.ok(tiles.some((t) => t.label.fr === 'Point de rosée'));
  const status = content.components.find((c) => c.type === 'status');
  assert.ok(status.items.some((i) => i.label.fr === 'Nuit étouffante'));
});

test('cold: wind chill heading, gust tile, frostbite delay, black ice', () => {
  const content = buildFeelsLikeContent(coldSnap(), { units: 'metric', now: FIXTURE_NOW });
  assert.match(content.components[0].text.fr, /^Refroidissement éolien −\d+°C$/);
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.ok(tiles.some((t) => t.label.fr === 'Dans les rafales'));
  const items = content.components.find((c) => c.type === 'status').items;
  const frostbite = items.find((i) => i.label.fr === 'Délai de gelure');
  assert.equal(frostbite.value.fr, '2 à 5 min'); // -32 °C at 30 km/h: wind chill -48
  assert.match(items.find((i) => i.label.fr === 'Verglas').value.fr, /^Probable · \d\d:\d\d$/);
  assert.equal(items.find((i) => i.label.fr === 'Prévisions pour').value, 'Montréal');
});

test('level colors', () => {
  assert.equal(levelColor('comfortable'), 'success');
  assert.equal(levelColor('cold_moderate'), 'info');
  assert.equal(levelColor('heat_discomfort'), 'warning');
  assert.equal(levelColor('cold_very_high'), 'danger');
});

test('the widget resolves the house from its setting', async () => {
  fake = installFetch(montrealRoutes());
  const gladys = createFakeGladys({
    houses: [{ id: '1', name: 'Maison', selector: 'maison', latitude: 45.5, longitude: -73.57 }],
  });
  const provider = new WeatherProvider({ now: () => FIXTURE_NOW });
  const watcher = new Watcher({ gladys, provider, getPreferences: () => ({}) });
  await watcher.refreshHouses();
  const seen = [];
  const { feels_like: widget } = createWidgets({
    provider,
    watcher,
    rememberPreferences: (p) => seen.push(p),
  });
  const content = await widget.get({ settings: {}, language: 'fr', units: 'metric' });
  assert.ok(content.components.length > 3);
  assert.deepEqual(seen, [{ language: 'fr', units: 'metric' }]);
  const missing = await widget.get({
    settings: { house: 'Chalet' },
    language: 'fr',
    units: 'metric',
  });
  assert.match(missing.components[0].text.fr, /Chalet/);
  assert.deepEqual(validateWidgetContent(missing), []);
});

const TORONTO_EAST = {
  id: 'FDQBU',
  name: { en: 'Toronto East', fr: 'Toronto Est' },
  distanceKm: 4.2,
};
const MONTREAL_AQHI = { id: 'EHHUN', name: { en: 'Montréal', fr: 'Montréal' }, distanceKm: 3.4 };

function airQuality(station, city, now = FIXTURE_NOW) {
  return buildAirQuality(
    station,
    parseObservation(fixture(`eccc-aqhi-observations-${city}.json`), now),
    parseForecast(fixture(`eccc-aqhi-forecasts-${city}.json`), now),
    now,
  );
}

// Wildfire smoke over Toronto: a very high AQHI, a smoke forecast.
function smoke() {
  const air = airQuality(TORONTO_EAST, 'toronto');
  return {
    ...air,
    current: { ...air.current, value: 10.6 },
    peak: { ...air.peak, value: 11 },
    periods: air.periods.map((p, i) => (i === 0 ? { ...p, smoke: 9 } : p)),
  };
}

const airCases = {
  'Toronto (measured)': airQuality(TORONTO_EAST, 'toronto'),
  'Montréal (forecast only)': airQuality(MONTREAL_AQHI, 'montreal'),
  smoke: smoke(),
};

for (const [name, air] of Object.entries(airCases)) {
  test(`the air quality widget is rendered exactly as sent: ${name}`, () => {
    const content = buildAirQualityContent(air, { utcOffsetMinutes: -240 });
    assert.deepEqual(validateWidgetContent(content), []);
  });
}

test('air quality: measured value, gauge, peak, periods, advice', () => {
  const content = buildAirQualityContent(airCases['Toronto (measured)'], {
    utcOffsetMinutes: -240,
  });
  const [heading] = content.components;
  assert.equal(heading.text.fr, 'Cote air santé 2 · Risque faible');
  assert.equal(heading.text.en, 'AQHI 2 · Low risk');
  const gauge = content.components.find((c) => c.type === 'gauge');
  assert.deepEqual([gauge.value, gauge.min, gauge.max, gauge.label.fr], [2, 1, 11, 'Maintenant']);
  assert.equal(gauge.color, 'success');
  const items = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(items.at(-1).label, { en: 'Measured at 07:00', fr: 'Mesurée à 07:00' });
  assert.equal(items.at(-1).value.fr, 'Toronto Est (4 km)');
  assert.ok(items.some((i) => i.label.fr === 'Ce soir et cette nuit'));
  const body = content.components.find((c) => c.type === 'text' && c.variant === 'body');
  assert.match(body.text.fr, /\nPersonnes à risque : Profitez/);
});

test('air quality: a forecast-only community says so', () => {
  const content = buildAirQualityContent(airCases['Montréal (forecast only)']);
  const gauge = content.components.find((c) => c.type === 'gauge');
  assert.equal(gauge.label.fr, 'Prévue maintenant');
  const items = content.components.find((c) => c.type === 'status').items;
  assert.equal(items.at(-1).label.fr, 'Prévision (pas de mesure)');
});

test('air quality in smoke: 10+, the smoke tile, the danger color', () => {
  const content = buildAirQualityContent(smoke());
  assert.equal(content.components[0].text.fr, 'Cote air santé 10+ · Risque très élevé');
  const gauge = content.components.find((c) => c.type === 'gauge');
  assert.equal(gauge.value, 11);
  assert.equal(gauge.color, 'danger');
  const smokeTile = content.components.find((c) => c.label?.fr === 'Dans la fumée');
  assert.equal(smokeTile.value, '9');
  const chart = content.components.find((c) => c.type === 'chart');
  assert.equal(chart.annotations[0].label.fr, 'Maximum');
});

test('the advice of every level fits the 300-character body', () => {
  for (const value of [2, 5, 8, 11]) {
    const content = buildAirQualityContent({
      ...airCases.smoke,
      current: { ...airCases.smoke.current, value },
    });
    assert.deepEqual(validateWidgetContent(content), [], `AQHI ${value}`);
  }
});

test('aqhi colors', () => {
  assert.equal(aqhiColor('low'), 'success');
  assert.equal(aqhiColor('moderate'), 'warning');
  assert.equal(aqhiColor('very_high'), 'danger');
  assert.equal(aqhiColor(undefined), 'neutral');
});

test('the air quality widget answers for the house, and says when there is no index', async () => {
  fake = installFetch(montrealRoutes());
  const gladys = createFakeGladys({
    houses: [
      { id: '1', name: 'Maison', selector: 'maison', ...MONTREAL },
      { id: '2', name: 'Chalet', selector: 'chalet', latitude: 49.5, longitude: -79.5 },
      { id: '3', name: 'Paris', selector: 'paris', latitude: 48.85, longitude: 2.35 },
    ],
  });
  const provider = new WeatherProvider({ now: () => FIXTURE_NOW, logger: silent });
  const watcher = new Watcher({ gladys, provider, getPreferences: () => ({}) });
  await watcher.refreshHouses();
  const { air_quality: widget } = createWidgets({ provider, watcher, rememberPreferences() {} });
  const content = await widget.get({ settings: {}, language: 'fr', units: 'metric' });
  assert.match(content.components[0].text.fr, /^Cote air santé \d+ · /);
  fake.restore();
  fake = installFetch([[/aqhi-stations/, () => json({ type: 'FeatureCollection', features: [] })]]);
  const none = await widget.get({ settings: { house: 'Chalet' }, language: 'fr' });
  assert.match(none.components[0].text.fr, /Aucune cote air santé à moins de 75 km/);
  const abroad = await widget.get({ settings: { house: 'Paris' }, language: 'fr' });
  assert.match(abroad.components[0].text.fr, /ne couvre que le Canada/);
});
