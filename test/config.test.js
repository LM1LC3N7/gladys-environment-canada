import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('defaults apply to an empty config', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test('form values are coerced, unknown values fall back to the default', () => {
  assert.deepEqual(
    normalizeConfig({
      official_alerts: 'false',
      air_quality_alerts: 'true',
      feels_like_alerts: true,
      radar_image: false,
      unknown: 1,
    }),
    {
      official_alerts: false,
      air_quality_alerts: true,
      feels_like_alerts: true,
      radar_image: false,
    },
  );
  assert.equal(normalizeConfig({ official_alerts: 'yes' }).official_alerts, true);
});
