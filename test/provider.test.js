import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { OutsideCanadaError, WeatherProvider } from '../src/provider.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { USER_AGENT } from '../src/constants.js';
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

function createProvider(config = {}, clock = { now: FIXTURE_NOW }) {
  const statuses = [];
  const provider = new WeatherProvider({
    getConfig: () => ({ ...DEFAULT_CONFIG, ...config }),
    now: () => clock.now,
    onStatus: (s) => statuses.push(s),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return { provider, statuses, clock };
}

const request = { ...MONTREAL, language: 'fr', units: 'metric' };
const cityCalls = (calls) => calls.filter((c) => c.url.includes('citypage')).length;

test('the nearest city page answers, with our User-Agent and the radar', async () => {
  fake = installFetch(montrealRoutes());
  const { provider, statuses } = createProvider();
  const weather = await provider.getWeather(request);
  const cc = fixture('eccc-citypage-montreal.json').properties.currentConditions;
  assert.equal(weather.temperature, cc.temperature.value.en);
  assert.equal(weather.apparent_temperature, cc.windChill.value.en);
  assert.ok(Number.isFinite(weather.uv_index));
  assert.deepEqual(statuses.at(-1), { ok: true, source: 'eccc' });
  assert.ok(fake.calls.every((c) => c.headers['User-Agent'] === USER_AGENT));
  assert.deepEqual(
    weather.images.map((i) => i.key),
    ['radar'],
  );
  assert.ok(!fake.calls.some((c) => c.url.includes('aqhi')), 'no air quality call by default');
});

test('the snapshot is cached 10 minutes; the city is then read by id', async () => {
  fake = installFetch(montrealRoutes());
  const { provider, clock } = createProvider();
  await Promise.all([provider.getWeather(request), provider.getWeather(request)]);
  assert.equal(cityCalls(fake.calls), 1);
  assert.match(
    fake.calls.find((c) => c.url.includes('citypage')).url,
    /items\?f=json&limit=100&bbox=/,
  );
  clock.now += 9 * 60_000;
  await provider.getWeather({ ...request, units: 'us', language: 'en' });
  assert.equal(cityCalls(fake.calls), 1, 'served from the cache, whatever the units');
  clock.now += 2 * 60_000;
  await provider.getWeather(request);
  assert.equal(cityCalls(fake.calls), 2);
  assert.match(
    fake.calls.filter((c) => c.url.includes('citypage'))[1].url,
    /items\/qc-147\?f=json$/,
  );
});

test('when the city page fails, the last snapshot is served for 3 hours', async () => {
  let down = false;
  fake = installFetch([
    [
      /citypage/,
      (url) => (down ? json({}, 500) : montrealRoutes().find(([p]) => p.test(url))[1]()),
    ],
    ...montrealRoutes(),
  ]);
  const { provider, clock, statuses } = createProvider();
  const fresh = await provider.getWeather(request);
  down = true;
  clock.now += 60 * 60_000;
  const stale = await provider.getWeather(request);
  assert.equal(stale.temperature, fresh.temperature);
  assert.equal(statuses.at(-1).ok, false);
  clock.now += 3 * 60 * 60_000;
  await assert.rejects(provider.getWeather(request), /HTTP 500/);
});

test('outside Canada: an explicit error, no call', async () => {
  fake = installFetch(montrealRoutes());
  const { provider, statuses } = createProvider();
  await assert.rejects(
    provider.getWeather({ ...request, latitude: 48.85, longitude: 2.35 }),
    OutsideCanadaError,
  );
  assert.equal(fake.calls.length, 0);
  assert.ok(statuses.at(-1).error instanceof OutsideCanadaError);
});

test('official alerts at the house, cached 5 minutes, and kept on a failed refresh', async () => {
  const quebec = { latitude: 46.8, longitude: -70.8, language: 'fr', units: 'metric' };
  let alertsDown = false;
  fake = installFetch([
    [/weather-alerts/, () => (alertsDown ? json({}, 500) : json(fixture('eccc-alerts.json')))],
    ...montrealRoutes({ city: cityPageAt({ at: quebec }) }),
  ]);
  const { provider, clock } = createProvider();
  const weather = await provider.getWeather(quebec);
  assert.deepEqual(
    weather.alerts.map((a) => [a.event, a.severity, a.type]),
    [['Avis de gel', 'moderate', 'cold']],
  );
  alertsDown = true;
  clock.now += 6 * 60_000;
  const again = await provider.getWeather(quebec);
  assert.equal(again.alerts.length, 1, 'a failed call does not erase an alert');
});

test('alerts disabled: no call, no alert', async () => {
  fake = installFetch(
    montrealRoutes({ city: cityPageAt({ at: { latitude: 46.8, longitude: -70.8 } }) }),
  );
  const { provider } = createProvider({ official_alerts: false });
  const weather = await provider.getWeather({ ...request, latitude: 46.8, longitude: -70.8 });
  assert.deepEqual(weather.alerts, []);
  assert.ok(!fake.calls.some((c) => c.url.includes('weather-alerts')));
});

test('synthetic feels-like alerts are opt-in and untyped', async () => {
  const city = cityPageAt({
    edit: ({ currentConditions: cc }) => {
      cc.temperature.value = { en: -30, fr: -30 };
      cc.wind.speed.value = { en: 40, fr: 40 };
    },
  });
  fake = installFetch(montrealRoutes({ city }));
  const off = createProvider().provider;
  assert.deepEqual((await off.getWeather(request)).alerts, []);
  const on = createProvider({ feels_like_alerts: true }).provider;
  const [alert] = (await on.getWeather(request)).alerts;
  assert.equal(alert.severity, 'severe'); // wind chill -45: very high risk
  assert.equal(alert.type, undefined);
  assert.match(alert.event, /Refroidissement éolien/);
});

test('the air quality of the nearest community, cached 15 minutes', async () => {
  fake = installFetch(montrealRoutes());
  const { provider, clock } = createProvider();
  const air = await provider.getAirQuality(MONTREAL.latitude, MONTREAL.longitude);
  assert.equal(air.station.id, 'EHHUN');
  assert.equal(air.current.observed, false, 'Montréal has forecasts, no observation');
  assert.ok(air.hours.length >= 20);
  const aqhiCalls = () => fake.calls.filter((c) => c.url.includes('aqhi')).length;
  assert.equal(aqhiCalls(), 3);
  clock.now += 14 * 60_000;
  await provider.getAirQuality(MONTREAL.latitude, MONTREAL.longitude);
  assert.equal(aqhiCalls(), 3);
  clock.now += 2 * 60_000;
  await provider.getAirQuality(MONTREAL.latitude, MONTREAL.longitude);
  assert.equal(aqhiCalls(), 5, 'the community is remembered, only the data is read again');
});

test('no AQHI community within reach: no air quality, asked once a day', async () => {
  fake = installFetch([[/aqhi-stations/, () => json({ type: 'FeatureCollection', features: [] })]]);
  const { provider, clock } = createProvider();
  assert.equal(await provider.getAirQuality(49.5, -79.5), undefined);
  clock.now += 20 * 60_000;
  assert.equal(await provider.getAirQuality(49.5, -79.5), undefined);
  assert.equal(fake.calls.length, 2, 'two search boxes, once');
});

test('air quality alerts are opt-in, from a high risk on', async () => {
  const forecasts = fixture('eccc-aqhi-forecasts-montreal.json');
  for (const feature of forecasts.features) {
    if (Number.isFinite(feature.properties.aqhi)) {
      feature.properties.aqhi = 8;
    }
  }
  fake = installFetch(montrealRoutes({ routes: [[/aqhi-forecasts/, () => json(forecasts)]] }));
  const off = createProvider().provider;
  assert.deepEqual((await off.getWeather(request)).alerts, []);
  const on = createProvider({ air_quality_alerts: true }).provider;
  const [alert] = (await on.getWeather(request)).alerts;
  assert.equal(alert.severity, 'moderate');
  assert.equal(alert.event, 'Mauvaise qualité de l’air (cote air santé)');
  assert.match(alert.description, /^Cote air santé 8 à Montréal, risque élevé\./);
});

test('invalid coordinates are refused', async () => {
  fake = installFetch([]);
  const { provider } = createProvider();
  await assert.rejects(provider.getWeather({ ...request, latitude: null }), /coordinates/);
});

test('only the radar image key is served', async () => {
  fake = installFetch([]);
  const { provider } = createProvider();
  await assert.rejects(provider.getImage('other'), /Unknown image/);
  await assert.rejects(provider.getImage('radar'), /No location/);
  const disabled = createProvider({ radar_image: false }).provider;
  await assert.rejects(disabled.getImage('radar'), /Unknown image/);
});
