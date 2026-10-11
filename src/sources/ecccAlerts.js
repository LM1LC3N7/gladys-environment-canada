// -----------------------------------------------------------------------------
// Official weather alerts of Environment and Climate Change Canada.
//
// OGC API: https://api.weather.gc.ca/collections/weather-alerts — one feature
// per (alert, forecast region) with its polygon, bilingual texts, the alert
// type (warning / watch / advisory / statement), the status (issued,
// continued, ended...) and, since the colour-coded system, a risk colour.
//
// Mapped to the pivot alerts (CAP severities, phenomenon types). Both
// languages are kept: the text is picked when the pivot is built.
// -----------------------------------------------------------------------------

import { ECCC_API_URL } from '../constants.js';
import { fetchJson } from '../http.js';
import { geometryContains } from '../geo.js';

const COLLECTION_URL = `${ECCC_API_URL}/collections/weather-alerts/items`;
// Tiny box around the house: the polygons are then tested exactly.
const SEARCH_RADIUS = 0.01;

const INACTIVE_STATUSES = new Set(['ended', 'cancelled', 'canceled', 'expired']);

const COLOUR_SEVERITY = { red: 'extreme', orange: 'severe', yellow: 'moderate' };
// Older alerts carry no colour: their type gives the order of magnitude.
const TYPE_SEVERITY = {
  warning: 'moderate',
  watch: 'minor',
  advisory: 'minor',
  statement: 'minor',
};

// Order matters: the first match wins ("freezing rain" before "rain",
// "coastal flooding" before "flood"). Freezing rain is a `snow` alert like
// the Météo-France "neige-verglas" vigilance the pivot types derive from.
const TYPE_PATTERNS = [
  ['coastal', /coastal|côti[eè]re|storm surge|onde de tempête|submersion/i],
  ['snow', /freezing (rain|drizzle)|(pluie|bruine) verglaçante|blizzard|snow|neige|poudrerie/i],
  ['heat', /heat|chaleur/i],
  ['cold', /cold|froid|frost|\bgel\b/i],
  ['thunderstorm', /thunderstorm|orage|tornad/i],
  ['flood', /flood|inondation/i],
  ['rain', /rain|pluie/i],
  ['wind', /wind|vent|hurricane|ouragan|tropical storm|tempête tropicale|suêtes|wreckhouse/i],
  ['fog', /fog|brouillard/i],
  ['avalanche', /avalanche/i],
];

export function alertType(properties) {
  const name = `${properties?.alert_name_en ?? ''} ${properties?.alert_name_fr ?? ''}`;
  return TYPE_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0];
}

export function alertSeverity(properties) {
  const colour = String(properties?.risk_colour_en ?? '').toLowerCase();
  return (
    COLOUR_SEVERITY[colour] ??
    TYPE_SEVERITY[String(properties?.alert_type ?? '').toLowerCase()] ??
    'minor'
  );
}

const capitalize = (text) =>
  typeof text === 'string' && text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;

const dateOrUndefined = (value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};

/**
 * Active alerts of a GeoJSON answer at a point: polygon containing it,
 * status still active, not expired. One entry per alert (an alert spans
 * several region features).
 */
export function parseAlerts(body, latitude, longitude, now = Date.now()) {
  const alerts = new Map();
  for (const feature of body?.features ?? []) {
    const p = feature?.properties;
    if (!p || !geometryContains(feature.geometry, latitude, longitude)) {
      continue;
    }
    if (INACTIVE_STATUSES.has(String(p.status_en).toLowerCase())) {
      continue;
    }
    const expires = Date.parse(p.expiration_datetime);
    if (Number.isFinite(expires) && expires < now) {
      continue;
    }
    // The feature id is "<alert id>_<region id>".
    const id = `${String(feature.id).split('_')[0]}:${p.alert_code}`;
    if (alerts.has(id)) {
      continue;
    }
    alerts.set(id, {
      id,
      code: p.alert_code,
      type: alertType(p),
      severity: alertSeverity(p),
      colour: p.risk_colour_en ?? undefined,
      event: { en: capitalize(p.alert_name_en), fr: capitalize(p.alert_name_fr) },
      description: { en: p.alert_text_en, fr: p.alert_text_fr },
      start: dateOrUndefined(p.validity_datetime) ?? dateOrUndefined(p.publication_datetime),
      end: dateOrUndefined(p.event_end_datetime) ?? dateOrUndefined(p.expiration_datetime),
    });
  }
  return [...alerts.values()];
}

export async function fetchAlerts(latitude, longitude, { timeout, now = Date.now() } = {}) {
  const r = SEARCH_RADIUS;
  const bbox = [longitude - r, latitude - r, longitude + r, latitude + r]
    .map((v) => v.toFixed(4))
    .join(',');
  const body = await fetchJson(`${COLLECTION_URL}?f=json&limit=100&bbox=${bbox}`, { timeout });
  return parseAlerts(body, latitude, longitude, now);
}
