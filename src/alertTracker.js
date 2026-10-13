// -----------------------------------------------------------------------------
// Scene triggers "alert issued" / "alert ended" (manifest `scene_triggers`).
//
// Per house, the highest level of each alert kind is compared with the
// previous evaluation, kept in /data: a new kind or a higher level fires
// "issued" (the warning replacing a watch too), a kind gone fires "ended".
// Compared by kind and level, never by identifier: an updated alert gets a
// new one. A kind gone only because its end time passed waits for an answer
// of ECCC made after that time (an alert is often extended at the last
// minute). The memory is written once Gladys accepted the event, so a
// refused event fires again.
// -----------------------------------------------------------------------------

import { ALERT_ENDED_TRIGGER, ALERT_ISSUED_TRIGGER } from './constants.js';
import { KIND_NAMES, LEVEL_NAMES, alertTitle, textLanguage, when } from './i18n.js';

const MAX_EVENT_TEXT = 1000;
const truncate = (text, max) =>
  typeof text === 'string' && text.length > max ? `${text.slice(0, max - 1)}…` : (text ?? '');

/** The highest alert of each kind: `{ kind: { real, watch } }`. */
export function byKind(alerts) {
  const kinds = {};
  for (const alert of alerts) {
    const entry = (kinds[alert.kind] ??= {});
    const slot = alert.watch ? 'watch' : 'real';
    if (!entry[slot] || alert.level > entry[slot].level) {
      entry[slot] = alert;
    }
  }
  return kinds;
}

export class AlertTracker {
  static FILE = 'alerts.json';

  /**
   * @param {{ store?: object, now?: () => number }} options the /data store
   */
  constructor({ store, now } = {}) {
    this.store = store;
    this.now = now ?? Date.now;
    // house key -> { kinds: { kind: { level, watch } } }
    this.memory = store?.load(AlertTracker.FILE)?.areas ?? {};
    this.ends = {};
  }

  forget(houseKey) {
    delete this.memory[houseKey];
    this.save();
  }

  /** Drop the houses no longer followed. */
  keepOnly(keys) {
    const keep = new Set(keys);
    let changed = false;
    for (const key of Object.keys(this.memory)) {
      if (!keep.has(key)) {
        delete this.memory[key];
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  save() {
    this.store?.save(AlertTracker.FILE, { areas: this.memory });
  }

  /**
   * Compare the alerts of a house with the previous evaluation and return
   * the events to publish; each event carries `commit()`, to call once
   * Gladys accepted it (the memory is then updated and saved).
   * @param {{ key: string, name?: string, timeZone?: string }} house
   * @param {object[]} alerts parsed alerts, expired ones excluded
   * @param {number} fetchedAt when ECCC answered
   * @param {{ language?: string }} preferences
   */
  evaluate(house, alerts, fetchedAt, { language } = {}) {
    const lang = textLanguage(language);
    const now = this.now();
    const context = { now, timeZone: house.timeZone ?? 'America/Toronto', language: lang };
    const current = byKind(alerts);
    const previous = this.memory[house.key];
    const next = { kinds: {} };
    const events = [];
    const commit = (kind, value) => () => {
      const entry = (this.memory[house.key] ??= { kinds: {} });
      if (value === undefined) {
        delete entry.kinds[kind];
      } else {
        entry.kinds[kind] = value;
      }
      this.save();
    };
    for (const [kind, { real, watch }] of Object.entries(current)) {
      const before = previous?.kinds?.[kind];
      const level = real?.level ?? 0;
      const watchLevel = watch?.level ?? 0;
      const value = { level, watch: watchLevel };
      next.kinds[kind] = value;
      if (!previous) {
        continue; // baseline
      }
      const issued =
        (real &&
          (!before || level > (before.level ?? 0) || (before.level === 0 && before.watch > 0))) ||
        (!real && watch && (!before || watchLevel > (before.watch ?? 0)));
      if (issued) {
        events.push({
          key: ALERT_ISSUED_TRIGGER,
          data: this.issuedData(house, real ?? watch, context),
          commit: commit(kind, value),
        });
      }
    }
    if (previous) {
      for (const [kind, before] of Object.entries(previous.kinds ?? {})) {
        if (current[kind]) {
          continue;
        }
        const ended = this.ends[house.key]?.[kind];
        if (ended !== undefined && ended <= now && fetchedAt < ended) {
          next.kinds[kind] = before;
          continue;
        }
        events.push({
          key: ALERT_ENDED_TRIGGER,
          data: this.endedData(house, kind, before, context),
          commit: commit(kind, undefined),
        });
      }
    }
    this.ends[house.key] = Object.fromEntries(
      Object.entries(current).map(([kind, { real, watch }]) => [
        kind,
        Math.max(real?.expiresMs ?? 0, watch?.expiresMs ?? 0) || undefined,
      ]),
    );
    if (!previous) {
      this.memory[house.key] = next;
      this.save();
    }
    return events;
  }

  eventBase(house, kind, level, { language }) {
    return {
      house: house.name ?? '',
      type: kind,
      type_name: KIND_NAMES[language][kind] ?? kind,
      level,
      level_name: LEVEL_NAMES[language][level] ?? '',
    };
  }

  issuedData(house, alert, context) {
    const base = this.eventBase(house, alert.kind, alert.level, context);
    const onset = alert.onsetMs;
    const active = !alert.watch && (onset === undefined || onset <= context.now);
    const title = alertTitle(alert, context.language);
    return {
      ...base,
      title,
      alert_type: alert.alertType ?? '',
      start: onset === undefined ? '' : when(onset, context),
      end: alert.expiresMs === undefined ? '' : when(alert.expiresMs, context),
      start_iso: alert.start ?? '',
      end_iso: alert.end ?? '',
      in_force: active,
      watch: Boolean(alert.watch),
      description: truncate(
        alert.description?.[context.language] ?? alert.description?.en,
        MAX_EVENT_TEXT,
      ),
      summary: `${base.house ? `${base.house}: ` : ''}${title}${
        alert.expiresMs === undefined ? '' : `, ${when(alert.expiresMs, context)}`
      }`,
    };
  }

  endedData(house, kind, before, context) {
    const level = before.level || before.watch || 0;
    const base = this.eventBase(house, kind, level, context);
    return { ...base, title: `${base.type_name} (${LEVEL_NAMES[context.language][level] ?? ''})` };
  }
}
