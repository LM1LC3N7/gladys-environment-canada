// -----------------------------------------------------------------------------
// Scene triggers "feels-like level changed" and "air quality level changed"
// (manifest `scene_triggers`).
//
// The Gladys scene engine compares exact values, it has no thresholds: the
// humidex / wind chill is turned into discrete levels (src/feelsLike.js) and
// an event is fired per CROSSED level, so a scene filtered on "cold_high"
// still fires when the wind chill jumps straight to "cold_very_high".
//
// One event per transition, never one per poll; the first evaluation of a
// house is a baseline (a restart in the middle of a cold snap must not fire
// every scene again); leaving a level needs a 1-unit margin (hysteresis).
// The AQHI follows the same rules with its own four levels (src/aqhi.js).
// -----------------------------------------------------------------------------

import { AIR_QUALITY_TRIGGER, FEELS_LIKE_TRIGGER } from './constants.js';
import {
  aqhiLevelWithHysteresis,
  crossedAqhiLevels,
  formatAqhi,
  getAqhiLevel,
  roundAqhi,
} from './aqhi.js';
import { INDEX_KINDS, crossedLevels, getLevel, levelWithHysteresis } from './feelsLike.js';
import { describeIndex } from './i18n.js';
import { converters, textLanguage, UNITS } from './pivot.js';

export const SCENE_TRIGGER_KEYS = [FEELS_LIKE_TRIGGER, AIR_QUALITY_TRIGGER];

export class FeelsLikeTracker {
  constructor() {
    // house key -> current level
    this.levels = new Map();
  }

  forget(houseKey) {
    this.levels.delete(houseKey);
  }

  /**
   * Evaluate one house and return the events to publish (possibly none).
   * @param {{ key: string, name?: string }} house
   * @param {object} assessment see src/assessment.js
   * @param {{ language?: string, units?: string }} preferences of the user
   */
  evaluate(house, assessment, { language, units } = {}) {
    if (!assessment?.index) {
      return [];
    }
    const previous = this.levels.get(house.key);
    const level = levelWithHysteresis(assessment.index, previous);
    this.levels.set(house.key, level);
    if (previous === undefined || previous === level) {
      return [];
    }
    const lang = textLanguage(language);
    const convert = converters(units);
    const unit = units === UNITS.US ? '°F' : '°C';
    const { index } = assessment;
    // Humidex is a number without unit; the wind chill reads as a temperature.
    const value =
      index.kind === INDEX_KINDS.HUMIDEX
        ? index.value
        : Math.round(convert.temperature(index.value));
    const finalLevel = getLevel(level);
    const summary = `${describeIndex({ ...index, value }, finalLevel, lang, unit)}. ${finalLevel.advice[lang]}`;
    return crossedLevels(previous, level).map(({ level: crossed, direction }) => ({
      key: FEELS_LIKE_TRIGGER,
      data: {
        level: crossed,
        direction,
        previous_level: previous,
        current_level: level,
        index: index.kind,
        value,
        unit: index.kind === INDEX_KINDS.HUMIDEX ? '' : unit,
        house: house.name ?? '',
        summary,
      },
    }));
  }
}

export class AirQualityTracker {
  constructor() {
    // house key -> current AQHI level
    this.levels = new Map();
  }

  forget(houseKey) {
    this.levels.delete(houseKey);
  }

  /**
   * Evaluate the air quality of one house and return the events to publish.
   * @param {{ key: string, name?: string }} house
   * @param {object | undefined} airQuality see src/sources/ecccAqhi.js
   * @param {{ language?: string }} preferences of the user
   */
  evaluate(house, airQuality, { language } = {}) {
    const value = airQuality?.current?.value;
    if (!Number.isFinite(value)) {
      return [];
    }
    const previous = this.levels.get(house.key);
    const level = aqhiLevelWithHysteresis(value, previous);
    this.levels.set(house.key, level);
    if (previous === undefined || previous === level) {
      return [];
    }
    const lang = textLanguage(language);
    const details = getAqhiLevel(level);
    const name = lang === 'fr' ? 'Cote air santé' : 'Air Quality Health Index';
    const separator = lang === 'fr' ? ' : ' : ': ';
    const summary = `${name} ${formatAqhi(value)}${separator}${details.label[lang].toLowerCase()}. ${details.advice[lang]}`;
    return crossedAqhiLevels(previous, level).map(({ level: crossed, direction }) => ({
      key: AIR_QUALITY_TRIGGER,
      data: {
        level: crossed,
        direction,
        previous_level: previous,
        current_level: level,
        value: roundAqhi(value),
        station: airQuality.station.name[lang] ?? airQuality.station.name.en,
        house: house.name ?? '',
        summary,
      },
    }));
  }
}
