// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENE_TRIGGER_KEYS } from '../src/sceneTriggers.js';
import { createWidgets } from '../src/widgets.js';
import { createActions } from '../src/actions.js';
import { createSceneActions } from '../src/scenes.js';
import { ALERT_KINDS, LEVEL_BY_SEVERITY } from '../src/sources/ecccAlerts.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { LEVEL_KEYS } from '../src/feelsLike.js';
import { AQHI_LEVELS } from '../src/aqhi.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...(manifest.contact_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const WIDGETS = createWidgets({});
const ACTIONS = createActions({});
const SCENE_ACTIONS = createSceneActions({});

// Manifest fields older Gladys releases reject as unknown, with the first
// release accepting them. The store validator refuses a manifest whose
// `gladys_version` minimum is lower: these tests catch it before a release.
const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('a weather provider that needs the house location', () => {
  assert.equal(manifest.type, 'weather');
  // The background loop (alerts, scene triggers, widget) reads the houses.
  assert.equal(manifest.location, true);
});

test('every manifest action has a handler, and vice versa', () => {
  const declared = keysOf(manifest.actions);
  for (const key of declared) {
    assert.equal(typeof ACTIONS[key], 'function', `manifest action "${key}" has no handler`);
  }
  for (const key of Object.keys(ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in actions`);
  }
});

test('the feels-like trigger offers exactly the computed levels', () => {
  const trigger = manifest.scene_triggers.find((t) => t.key === 'feels_like_level_changed');
  const level = trigger.fields.find((f) => f.key === 'level');
  assert.deepEqual(
    level.options.map((o) => o.value),
    LEVEL_KEYS,
  );
  // The scene engine refuses boolean filters on triggers.
  for (const field of trigger.fields) {
    assert.ok(['string', 'number', 'select', 'multi_select', 'section'].includes(field.type));
  }
});

test('the air quality trigger offers exactly the AQHI levels', () => {
  const trigger = manifest.scene_triggers.find((t) => t.key === 'air_quality_level_changed');
  const level = trigger.fields.find((f) => f.key === 'level');
  assert.deepEqual(
    level.options.map((o) => o.value),
    AQHI_LEVELS.map((l) => l.key),
  );
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  // The store vocabulary itself is checked by the store validator (unknown
  // keys are dropped with a warning there) — what this test pins is the
  // coupling rule: older cores reject any unknown manifest field, so a
  // manifest declaring `categories` must not claim compatibility below the
  // first release that accepts it.
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(
    isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.ok(declared.length > 0, 'the integration declares capability fields');
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `${declared.join(', ')} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('every widgets key has an onWidgetGet handler, and vice versa', () => {
  const declared = keysOf(manifest.widgets);
  for (const key of declared) {
    assert.equal(typeof WIDGETS[key]?.get, 'function', `widget "${key}" has no content handler`);
  }
  for (const key of Object.keys(WIDGETS)) {
    assert.ok(declared.includes(key), `widget "${key}" is not declared in widgets`);
  }
});

test('every scene action has a handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  for (const key of declared) {
    assert.equal(typeof SCENE_ACTIONS[key], 'function', `scene action "${key}" has no handler`);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in scene_actions`);
  }
});

test('the alert triggers offer exactly the kinds and levels the code fires', () => {
  for (const key of ['alert_issued', 'alert_ended']) {
    const trigger = manifest.scene_triggers.find((t) => t.key === key);
    const type = trigger.fields.find((f) => f.key === 'type');
    assert.deepEqual(
      type.options.map((o) => o.value),
      ALERT_KINDS,
    );
  }
  const issued = manifest.scene_triggers.find((t) => t.key === 'alert_issued');
  const level = issued.fields.find((f) => f.key === 'level');
  assert.deepEqual(
    level.options.map((o) => o.value),
    Object.values(LEVEL_BY_SEVERITY).map(String),
  );
});

test('every scene trigger the code fires is declared in scene_triggers, and vice versa', () => {
  // An undeclared key is a 404 on publishSceneEvent; a declared key nobody
  // fires is a dead card in the scene editor.
  const declared = keysOf(manifest.scene_triggers);
  for (const key of SCENE_TRIGGER_KEYS) {
    assert.ok(declared.includes(key), `trigger "${key}" is fired but not declared`);
  }
  for (const key of declared) {
    assert.ok(SCENE_TRIGGER_KEYS.includes(key), `trigger "${key}" is declared but never fired`);
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0, 'the configuration starts with an intro section');
  for (const section of sections) {
    // A section stores NO value: declaring `required`, `default` or
    // `placeholder` on it rejects the manifest, and its key must never leak
    // into the config the code manipulates.
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('no dynamic source: the store schema only knows "devices", and we have none', () => {
  // `source: "houses"` exists in the core but the store validator refuses
  // it: the house is a free text (its name) instead.
  assert.deepEqual(
    allFields.filter((f) => f.source !== undefined),
    [],
  );
});

test('select options are strings and defaults are among them', () => {
  for (const field of allFields.filter((f) => f.type === 'select' || f.type === 'multi_select')) {
    for (const option of field.options) {
      assert.equal(typeof option.value, 'string');
      assert.ok(option.label.en && option.label.fr, `${field.key}.${option.value} label`);
    }
    if (field.default !== undefined) {
      assert.ok(field.options.some((o) => o.value === field.default));
    }
  }
});

test('widget labels hold 3 to 30 characters, descriptions at most 100', () => {
  for (const widget of manifest.widgets) {
    assert.match(widget.key, /^[a-z0-9_]{2,32}$/);
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, `widget label "${text}"`);
    }
    for (const text of Object.values(widget.description ?? {})) {
      assert.ok(text.length <= 100, `widget description "${text}"`);
    }
  }
});

test('every text is bilingual (English and French)', () => {
  const texts = [
    manifest.description,
    ...allFields.flatMap((f) => [f.label, f.description, f.placeholder]),
    ...allFields.flatMap((f) => (f.options ?? []).map((o) => o.label)),
    ...[
      ...manifest.actions,
      ...manifest.scene_triggers,
      ...manifest.scene_actions,
      ...manifest.widgets,
    ].flatMap((e) => [e.label, e.description]),
    ...manifest.scene_triggers.flatMap((t) => t.variables.map((v) => v.label)),
    ...manifest.scene_actions.flatMap((a) => a.outputs.map((v) => v.label)),
  ].filter(Boolean);
  for (const text of texts) {
    assert.ok(text.en && text.fr, `missing translation: ${JSON.stringify(text)}`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  // A store rule (the catalog card is short): a longer text rejects the
  // manifest.
  assert.ok(manifest.description.en, 'the description needs an English text');
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  // Like `label` and `description`: a plain string rejects the manifest.
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0, 'the house fields show an example');
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
