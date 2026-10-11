import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDaylight, sunTimes } from '../src/sun.js';
import { fixture } from './helpers/fakeFetch.js';

const minutesBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 60_000;

test('sunrise and sunset agree with the ECCC city page within 3 minutes', () => {
  const page = fixture('eccc-citypage-montreal.json');
  const [longitude, latitude] = page.geometry.coordinates;
  const { sunrise, sunset } = sunTimes('2026-10-10', latitude, longitude);
  assert.ok(minutesBetween(sunrise, page.properties.riseSet.sunrise.en) < 3);
  assert.ok(minutesBetween(sunset, page.properties.riseSet.sunset.en) < 3);
});

test('no sunrise during the polar night', () => {
  // Alert, Nunavut, at the winter solstice.
  assert.deepEqual(sunTimes('2026-12-21', 82.5, -62.3), {});
});

test('day and night from the sun elevation', () => {
  assert.equal(isDaylight('2026-10-10T17:00:00Z', 45.5, -73.57), true);
  assert.equal(isDaylight('2026-10-10T03:00:00Z', 45.5, -73.57), false);
});
