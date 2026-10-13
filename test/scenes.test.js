import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/scenes.js';
import { parseAlerts } from '../src/sources/ecccAlerts.js';
import { FIXTURE_NOW, fixture } from './helpers/fakeFetch.js';

const chalet = { key: 'chalet', name: 'Chalet', timeZone: 'America/Toronto' };
const home = { key: 'home', name: 'Home', timeZone: 'America/Vancouver' };

test('summarize writes one block per house with the levels', () => {
  const alerts = parseAlerts(fixture('eccc-alerts.json'), 46.8, -70.8, FIXTURE_NOW);
  const result = summarize(
    [
      { house: chalet, alerts },
      { house: home, alerts: [] },
    ],
    { now: FIXTURE_NOW, language: 'fr' },
  );
  assert.equal(result.count, 1);
  assert.equal(result.current_level, 2);
  assert.equal(result.upcoming_level, 0);
  assert.equal(result.current_level_name, 'Modérée');
  assert.equal(
    result.summary,
    [
      'Chalet : 1 alerte météo',
      '- Avis de gel (niveau 2), jusqu’à demain 10:00',
      '',
      'Home : aucune alerte météo.',
    ].join('\n'),
  );
  const english = summarize([{ house: chalet, alerts }], { now: FIXTURE_NOW, language: 'en' });
  assert.match(
    english.summary,
    /Chalet: 1 weather alert\n- Frost advisory \(level 2\), until tomorrow 10:00/,
  );
  assert.match(summarize([], { now: FIXTURE_NOW, language: 'en' }).summary, /No located house/);
});
