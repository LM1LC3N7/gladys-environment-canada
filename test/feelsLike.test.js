import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMFORTABLE,
  INDEX_KINDS,
  LEVEL_KEYS,
  crossedLevels,
  dewPointFromHumidity,
  feelsLikeIndex,
  humidex,
  levelOf,
  levelWithHysteresis,
  windChill,
  worstHour,
} from '../src/feelsLike.js';

test('humidex matches the ECCC worked example', () => {
  // ECCC glossary: 30 °C with a 15 °C dew point gives a humidex of 34.
  assert.equal(Math.round(humidex(30, 15)), 34);
  assert.equal(humidex(30, undefined), undefined);
});

test('humidex regression values (ECCC formula, one decimal)', () => {
  const table = [
    [30, 20, 37.6],
    [25, 20, 32.6],
    [35, 25, 47.3],
    [20, 10, 21.3],
  ];
  for (const [t, td, expected] of table) {
    assert.equal(Math.round(humidex(t, td) * 10) / 10, expected, `humidex(${t}, ${td})`);
  }
});

test('wind chill matches the ECCC worked examples', () => {
  // ECCC wind chill chart: -20 °C at 30 km/h -> -33, -25 °C at 20 km/h -> -37.
  assert.equal(Math.round(windChill(-20, 30)), -33);
  assert.equal(Math.round(windChill(-25, 20)), -37);
});

test('wind chill regression values (JAG/TI formula, one decimal)', () => {
  const table = [
    [-10, 20, -17.9],
    [-30, 50, -49],
    [-40, 60, -64.2],
    [0, 40, -7.4],
    [5, 10, 2.7],
  ];
  for (const [t, v, expected] of table) {
    assert.equal(Math.round(windChill(t, v) * 10) / 10, expected, `windChill(${t}, ${v})`);
  }
});

test('wind chill is undefined above 10 °C and continuous at 5 km/h', () => {
  assert.equal(windChill(11, 30), undefined);
  assert.ok(Math.abs(windChill(-20, 4.999) - windChill(-20, 5)) < 0.2);
  assert.equal(windChill(-20, 0), -20);
});

test('the dew point is derived from the humidity', () => {
  assert.ok(Math.abs(dewPointFromHumidity(6, 65)) < 0.5);
  assert.equal(Math.round(dewPointFromHumidity(30, 50)), 18);
  assert.equal(dewPointFromHumidity(30, 0), undefined);
});

test('the index follows the season: humidex hot, wind chill cold, none between', () => {
  assert.deepEqual(feelsLikeIndex({ temperature: 30, dew_point: 20, wind_kmh: 10 }), {
    kind: INDEX_KINDS.HUMIDEX,
    value: 38,
  });
  assert.deepEqual(feelsLikeIndex({ temperature: -20, wind_kmh: 30 }), {
    kind: INDEX_KINDS.WIND_CHILL,
    value: -33,
  });
  assert.deepEqual(feelsLikeIndex({ temperature: 15, wind_kmh: 30 }), {
    kind: INDEX_KINDS.NONE,
    value: 15,
  });
  // No dew point: computed from the humidity.
  assert.equal(feelsLikeIndex({ temperature: 30, humidity: 50 }).kind, INDEX_KINDS.HUMIDEX);
});

test('levels follow the ECCC scales', () => {
  const at = (kind, value) => levelOf({ kind, value });
  assert.equal(at(INDEX_KINDS.WIND_CHILL, -9), COMFORTABLE);
  assert.equal(at(INDEX_KINDS.WIND_CHILL, -10), 'cold_moderate');
  assert.equal(at(INDEX_KINDS.WIND_CHILL, -28), 'cold_high');
  assert.equal(at(INDEX_KINDS.WIND_CHILL, -39), 'cold_high');
  assert.equal(at(INDEX_KINDS.WIND_CHILL, -40), 'cold_very_high');
  assert.equal(at(INDEX_KINDS.WIND_CHILL, -48), 'cold_severe');
  assert.equal(at(INDEX_KINDS.WIND_CHILL, -55), 'cold_extreme');
  assert.equal(at(INDEX_KINDS.HUMIDEX, 29), COMFORTABLE);
  assert.equal(at(INDEX_KINDS.HUMIDEX, 30), 'heat_discomfort');
  assert.equal(at(INDEX_KINDS.HUMIDEX, 45), 'heat_great_discomfort');
  assert.equal(at(INDEX_KINDS.HUMIDEX, 46), 'heat_danger');
  assert.equal(at(INDEX_KINDS.HUMIDEX, 54), 'heat_stroke');
  assert.equal(at(INDEX_KINDS.NONE, 50), COMFORTABLE);
});

test('a level is left only with a one-unit margin', () => {
  const wc = (value) => ({ kind: INDEX_KINDS.WIND_CHILL, value });
  assert.equal(levelWithHysteresis(wc(-27), 'cold_high'), 'cold_high');
  assert.equal(levelWithHysteresis(wc(-26), 'cold_high'), 'cold_moderate');
  // Entering a more severe level is immediate.
  assert.equal(levelWithHysteresis(wc(-28), 'cold_moderate'), 'cold_high');
  assert.equal(levelWithHysteresis(wc(-28), COMFORTABLE), 'cold_high');
  const hx = (value) => ({ kind: INDEX_KINDS.HUMIDEX, value });
  assert.equal(levelWithHysteresis(hx(29), 'heat_discomfort'), 'heat_discomfort');
  assert.equal(levelWithHysteresis(hx(28), 'heat_discomfort'), COMFORTABLE);
  assert.equal(levelWithHysteresis(hx(31), undefined), 'heat_discomfort');
});

test('every crossed level is reported, with its direction', () => {
  assert.deepEqual(crossedLevels(COMFORTABLE, 'cold_high'), [
    { level: 'cold_moderate', direction: 'worsening' },
    { level: 'cold_high', direction: 'worsening' },
  ]);
  assert.deepEqual(crossedLevels('heat_great_discomfort', COMFORTABLE), [
    { level: 'heat_discomfort', direction: 'improving' },
    { level: COMFORTABLE, direction: 'improving' },
  ]);
  assert.deepEqual(crossedLevels('cold_high', 'cold_high'), []);
  assert.equal(LEVEL_KEYS.length, 10);
});

test('the worst hour is the most severe index of the list', () => {
  const hours = [
    { datetime: 'a', temperature: -10, wind_speed: 2 },
    { datetime: 'b', temperature: -20, wind_speed: 30 / 3.6 },
    { datetime: 'c', temperature: -15, wind_speed: 1 },
  ];
  const worst = worstHour(hours);
  assert.equal(worst.hour.datetime, 'b');
  assert.equal(worst.index.value, -33);
  assert.equal(worst.level, 'cold_high');
  assert.equal(worstHour([{ datetime: 'x', temperature: 15, wind_speed: 3 }]), undefined);
});
