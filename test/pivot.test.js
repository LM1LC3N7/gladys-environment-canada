import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS } from '@gladysassistant/integration-sdk';
import { pivotAlerts, toPivot } from '../src/pivot.js';
import { parseCityPage } from '../src/sources/ecccCitypage.js';
import { FIXTURE_NOW, MONTREAL, fixture } from './helpers/fakeFetch.js';

const snapshot = parseCityPage(
  fixture('eccc-citypage-montreal.json'),
  MONTREAL.latitude,
  MONTREAL.longitude,
  FIXTURE_NOW,
);

const build = (options = {}) =>
  toPivot(snapshot, { ...MONTREAL, units: 'metric', language: 'fr', now: FIXTURE_NOW, ...options });

const CONDITIONS = new Set(Object.values(WEATHER_CONDITIONS));

test('the required fields are there, the units field is not', () => {
  const pivot = build();
  assert.equal(typeof pivot.temperature, 'number');
  assert.ok(CONDITIONS.has(pivot.weather));
  assert.ok(!Number.isNaN(Date.parse(pivot.datetime)));
  assert.equal(pivot.units, undefined, 'the core stamps the units itself');
  assert.equal(typeof pivot.is_day, 'boolean');
  assert.ok(pivot.sunrise < pivot.sunset);
});

test('hours and days stay within the pivot limits', () => {
  const pivot = build();
  // The city page holds 24 hours from its issue time: the past ones go.
  assert.ok(pivot.hours.length >= 22 && pivot.hours.length <= 24);
  assert.ok(pivot.days.length <= 8 && pivot.days.length > 0);
  for (const hour of pivot.hours) {
    assert.ok(CONDITIONS.has(hour.weather));
    assert.notEqual(hour.weather, 'night');
    assert.ok(hour.precipitation_probability >= 0 && hour.precipitation_probability <= 100);
  }
  // The first hour is the current one, not one of the past.
  assert.ok(Date.parse(pivot.hours[0].datetime) > FIXTURE_NOW - 3_600_000);
  for (const day of pivot.days) {
    assert.ok(day.temperature_min <= day.temperature_max);
    assert.ok(day.sunrise && day.sunset);
  }
});

test('us units: °F, mph; hPa unchanged', () => {
  const metric = build();
  const us = build({ units: 'us' });
  assert.equal(us.temperature, Math.round(((metric.temperature * 9) / 5 + 32) * 10) / 10);
  assert.ok(Math.abs(us.wind_speed - metric.wind_speed * 2.23694) < 0.25, 'both rounded');
  assert.equal(us.pressure, metric.pressure);
  assert.equal(
    us.days[0].temperature_max,
    Math.round(((metric.days[0].temperature_max * 9) / 5 + 32) * 10) / 10,
  );
});

test('alerts are written in the language of the request, within the limits', () => {
  const alerts = [
    {
      id: 'a',
      severity: 'moderate',
      type: 'cold',
      event: { en: 'Frost advisory', fr: 'Avis de gel' },
      description: { en: 'x'.repeat(6000), fr: 'Gel au sol.' },
      end: '2026-10-11T12:00:00.000Z',
    },
  ];
  const [fr] = pivotAlerts(alerts, 'fr');
  assert.deepEqual(fr, {
    severity: 'moderate',
    event: 'Avis de gel',
    description: 'Gel au sol.',
    type: 'cold',
    end: '2026-10-11T12:00:00.000Z',
  });
  const [en] = pivotAlerts(alerts, 'en-US');
  assert.equal(en.event, 'Frost advisory');
  assert.equal(en.description.length, 5000);
  assert.equal(pivotAlerts(new Array(15).fill(alerts[0]), 'fr').length, 10);
});

test('images are declared only when given', () => {
  assert.equal(build().images, undefined);
  const images = [{ key: 'radar', label: { en: 'Radar', fr: 'Radar' } }];
  assert.deepEqual(build({ images }).images, images);
});
