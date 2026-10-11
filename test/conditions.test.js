import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDITIONS, ecccCondition, ecccIsNightIcon } from '../src/conditions.js';

const PIVOT = new Set(Object.values(CONDITIONS));

test('every ECCC icon 0-48 maps to a pivot condition, never "night"', () => {
  for (let icon = 0; icon <= 48; icon += 1) {
    const condition = ecccCondition(icon);
    assert.ok(PIVOT.has(condition), `ECCC icon ${icon} -> ${condition}`);
    assert.notEqual(condition, 'night');
  }
});

test('ECCC icon codes', () => {
  assert.equal(ecccCondition(14), CONDITIONS.FREEZING_RAIN);
  assert.equal(ecccCondition(42), CONDITIONS.TORNADO);
  assert.equal(ecccCondition('03'), CONDITIONS.CLOUD);
  assert.equal(ecccCondition(99), CONDITIONS.UNKNOWN);
  assert.equal(ecccCondition(undefined), CONDITIONS.UNKNOWN);
  assert.equal(ecccIsNightIcon(31), true);
  assert.equal(ecccIsNightIcon(1), false);
});

test('fog at or below 0 °C is freezing fog', () => {
  assert.equal(ecccCondition(24, 2), CONDITIONS.FOG);
  assert.equal(ecccCondition(24, -5), CONDITIONS.FREEZING_FOG);
});
