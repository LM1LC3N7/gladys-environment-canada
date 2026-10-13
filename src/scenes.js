// -----------------------------------------------------------------------------
// Scene action "Current alerts" (manifest `scene_actions`): a summary ready
// to send in a message (Telegram, the chat, a speaker), plus the numbers a
// following condition can test. It reads what the provider already holds,
// in the language of the last widget or weather request (a scene action
// receives none).
// -----------------------------------------------------------------------------

import { GET_ALERTS_ACTION } from './constants.js';
import { LEVEL_NAMES, WORDS, alertTitle, period, textLanguage } from './i18n.js';
import { inForce } from './sources/ecccAlerts.js';

export const SCENE_ACTION_KEYS = [GET_ALERTS_ACTION];

const TEXTS = {
  en: {
    none: (house) => `${house}: no weather alert.`,
    header: (house, n) => `${house}: ${n} weather ${n === 1 ? 'alert' : 'alerts'}`,
    noHouse: 'No located house: place your house on the map in Gladys.',
  },
  fr: {
    none: (house) => `${house} : aucune alerte météo.`,
    header: (house, n) => `${house} : ${n} alerte${n > 1 ? 's' : ''} météo`,
    noHouse: 'Aucune maison localisée : placez votre maison sur la carte dans Gladys.',
  },
};

/**
 * The summary of the alerts of some houses (pure).
 * @param {{ house: object, alerts: object[] }[]} entries
 * @param {{ now: number, language?: string }} options
 */
export function summarize(entries, { now, language }) {
  const lang = textLanguage(language);
  const text = TEXTS[lang];
  const words = WORDS[lang];
  const blocks = [];
  let count = 0;
  let currentLevel = 0;
  let upcomingLevel = 0;
  for (const { house, alerts } of entries) {
    const name = house.name || house.key;
    const context = { now, timeZone: house.timeZone ?? 'America/Toronto', language: lang };
    const active = alerts.filter((a) => inForce(a, now));
    const upcoming = alerts.filter((a) => !inForce(a, now));
    count += alerts.length;
    currentLevel = Math.max(currentLevel, ...active.map((a) => a.level));
    upcomingLevel = Math.max(upcomingLevel, ...upcoming.map((a) => a.level));
    if (alerts.length === 0) {
      blocks.push(text.none(name));
      continue;
    }
    const lines = [text.header(name, alerts.length)];
    for (const alert of active) {
      lines.push(`- ${alertTitle(alert, lang)}, ${period(alert, true, context)}`);
    }
    for (const alert of upcoming) {
      const label = alert.watch ? `${words.watch}: ` : '';
      lines.push(`- ${label}${alertTitle(alert, lang)}, ${period(alert, false, context)}`);
    }
    blocks.push(lines.join('\n'));
  }
  return {
    summary: blocks.length > 0 ? blocks.join('\n\n') : text.noHouse,
    count,
    current_level: currentLevel,
    upcoming_level: upcomingLevel,
    current_level_name: LEVEL_NAMES[lang][currentLevel],
    upcoming_level_name: LEVEL_NAMES[lang][upcomingLevel],
  };
}

/**
 * @param {{ watcher: object, provider: object, getPreferences: Function, now?: Function }} deps
 */
export function createSceneActions({ watcher, provider, getPreferences, now = Date.now }) {
  return {
    [GET_ALERTS_ACTION]: async (fields = {}) => {
      const houses = watcher.housesFor(fields.house);
      const entries = await Promise.all(
        houses.map(async (house) => ({
          house,
          alerts: await provider.getAlerts(house.latitude, house.longitude),
        })),
      );
      return summarize(entries, { now: now(), language: getPreferences().language });
    },
  };
}
