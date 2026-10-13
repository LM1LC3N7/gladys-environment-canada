import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertTracker, byKind } from '../src/alertTracker.js';
import { createMemoryStore } from '../src/store.js';
import { parseAlerts } from '../src/sources/ecccAlerts.js';
import { FIXTURE_NOW, fixture } from './helpers/fakeFetch.js';

const HOUSE = { key: 'chalet', name: 'Chalet', timeZone: 'America/Toronto' };
const alertsAt = (now = FIXTURE_NOW) => parseAlerts(fixture('eccc-alerts.json'), 46.8, -70.8, now);

function tracker({ store = createMemoryStore(), now = FIXTURE_NOW } = {}) {
  const clock = { now };
  const t = new AlertTracker({ store, now: () => clock.now });
  return { t, store, clock };
}

test('byKind keeps the highest alert of each kind, watches apart', () => {
  const kinds = byKind([
    { kind: 'wind', level: 1, watch: false },
    { kind: 'wind', level: 2, watch: false },
    { kind: 'wind', level: 3, watch: true },
    { kind: 'fog', level: 1, watch: false },
  ]);
  assert.equal(kinds.wind.real.level, 2);
  assert.equal(kinds.wind.watch.level, 3);
  assert.equal(kinds.fog.real.level, 1);
});

test('baseline first, then a new kind or a higher level fires "issued"', () => {
  const { t, store, clock } = tracker();
  const frost = alertsAt();
  assert.equal(frost.length, 1);
  assert.deepEqual(t.evaluate(HOUSE, frost, FIXTURE_NOW, { language: 'fr' }), []);
  assert.deepEqual(Object.keys(JSON.parse(store.files.get('alerts.json')).areas.chalet.kinds), [
    'cold',
  ]);
  assert.deepEqual(t.evaluate(HOUSE, frost, FIXTURE_NOW, {}), []);
  // The advisory becomes a warning (orange), and a wind warning appears.
  const raised = frost.map((a) => ({ ...a, level: 3, severity: 'severe' }));
  raised.push({
    ...frost[0],
    id: 'wind',
    kind: 'wind',
    level: 2,
    event: { en: 'Wind warning', fr: 'Avertissement de vent' },
    onsetMs: FIXTURE_NOW + 3_600_000,
    start: new Date(FIXTURE_NOW + 3_600_000).toISOString(),
  });
  clock.now += 60_000;
  const events = t.evaluate(HOUSE, raised, clock.now, { language: 'fr' });
  assert.deepEqual(
    events.map((e) => [e.key, e.data.type, e.data.level, e.data.in_force]),
    [
      ['alert_issued', 'cold', 3, true],
      ['alert_issued', 'wind', 2, false],
    ],
  );
  const cold = events[0].data;
  assert.equal(cold.house, 'Chalet');
  assert.equal(cold.level_name, 'Sévère');
  assert.equal(cold.type_name, 'Froid');
  assert.equal(cold.title, 'Avis de gel (niveau 3)');
  assert.equal(cold.alert_type, 'advisory');
  assert.ok(cold.summary.startsWith('Chalet: Avis de gel (niveau 3)'));
  assert.equal(events[1].data.start, '09:30');
  // Not committed yet: the memory still says level 2.
  assert.equal(JSON.parse(store.files.get('alerts.json')).areas.chalet.kinds.cold.level, 2);
  events[0].commit();
  assert.equal(JSON.parse(store.files.get('alerts.json')).areas.chalet.kinds.cold.level, 3);
});

test('an alert gone fires "ended" once ECCC answered after its end time', () => {
  const { t, clock } = tracker();
  const frost = alertsAt();
  t.evaluate(HOUSE, frost, FIXTURE_NOW, {});
  const end = frost[0].expiresMs;
  clock.now = end + 60_000;
  // Fetched before the end: ECCC may extend it, wait.
  assert.deepEqual(t.evaluate(HOUSE, [], end - 60_000, {}), []);
  const events = t.evaluate(HOUSE, [], clock.now, { language: 'en' });
  assert.deepEqual(
    events.map((e) => [e.key, e.data.type, e.data.level, e.data.title]),
    [['alert_ended', 'cold', 2, 'Cold (Moderate)']],
  );
  events[0].commit();
  assert.deepEqual(t.evaluate(HOUSE, [], clock.now, {}), []);
});

test('a warning replacing a watch fires even at the same level', () => {
  const { t, clock } = tracker();
  const watch = [{ ...alertsAt()[0], watch: true, kind: 'thunderstorm', level: 2, id: 'w' }];
  t.evaluate(HOUSE, watch, FIXTURE_NOW, {});
  clock.now += 60_000;
  const events = t.evaluate(HOUSE, [{ ...watch[0], watch: false, id: 'r' }], clock.now, {});
  assert.equal(events.length, 1);
  assert.equal(events[0].data.watch, false);
});

test('the memory survives a restart and forgets the houses left', () => {
  const { t, store } = tracker();
  t.evaluate(HOUSE, alertsAt(), FIXTURE_NOW, {});
  const again = new AlertTracker({ store, now: () => FIXTURE_NOW + 60_000 });
  assert.deepEqual(again.evaluate(HOUSE, alertsAt(), FIXTURE_NOW + 60_000, {}), []);
  again.keepOnly(['other']);
  assert.deepEqual(JSON.parse(store.files.get('alerts.json')).areas, {});
});
