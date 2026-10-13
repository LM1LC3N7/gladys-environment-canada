// -----------------------------------------------------------------------------
// Entry point of the Environment Canada weather integration for Gladys
// Assistant.
//
// SDK wiring only — the logic lives in src/:
//   provider.js      ECCC sources, caches, alerts, air quality -> pivot weather
//   watcher.js       background loop: alerts nudge, scene events, widget nudges
//   widgets.js       "Alerts", "Feels like" and "Air quality" dashboard widgets
//   sceneTriggers.js feels-like, air quality, alert issued / ended scene triggers
//   scenes.js        "Current alerts" scene action
//   actions.js       Configuration screen "test" button
//
// Handlers are registered BEFORE connect(). The three GLADYS_* environment
// variables are injected by the Gladys supervisor and read by the SDK.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { OutsideCanadaError, WeatherProvider } from './src/provider.js';
import { Watcher } from './src/watcher.js';
import { createWidgets } from './src/widgets.js';
import { createActions } from './src/actions.js';
import { createSceneActions } from './src/scenes.js';
import { createStore } from './src/store.js';
import { UNITS } from './src/pivot.js';

const gladys = new GladysIntegration();

let config = normalizeConfig();

// Language and units of the user, for the texts and values we format
// ourselves (scene event summaries). The dashboard widget tells the truth;
// onWeatherGet only until a widget was seen, because the core's own alert
// job always asks in English and metric.
const preferences = { language: 'fr', units: UNITS.METRIC, fromWidget: false };
function rememberPreferences({ language, units }, fromWidget = true) {
  if (fromWidget || !preferences.fromWidget) {
    preferences.language = language ?? preferences.language;
    preferences.units = units ?? preferences.units;
    preferences.fromWidget ||= fromWidget;
  }
}

// Application-level status shown in the Configuration screen, only sent
// when it changes.
let lastStatus;
function reportStatus({ ok, source, error }) {
  const outside = error instanceof OutsideCanadaError;
  const status = ok ? `ok:${source}` : outside ? 'outside' : 'down';
  if (status === lastStatus) {
    return;
  }
  lastStatus = status;
  let message;
  if (outside) {
    message = {
      en: 'Your house is outside Canada: Environment Canada has no weather for it.',
      fr: 'Votre maison est hors du Canada : Environnement Canada n’a pas de météo pour elle.',
    };
  } else if (!ok) {
    message = {
      en: 'Environment Canada does not answer, check the logs.',
      fr: 'Environnement Canada ne répond pas, consultez les logs.',
    };
  }
  gladys.setConnectionStatus(ok, message).catch(() => {});
}

const provider = new WeatherProvider({ getConfig: () => config, onStatus: reportStatus });
const watcher = new Watcher({
  gladys,
  provider,
  getPreferences: () => preferences,
  store: createStore(),
});

// --- Weather (manifest type "weather", contract B.18) -----------------------
// Answered under 15 s; the cache (10 min) keeps it far below in practice.
gladys.onWeatherGet(async (options) => {
  logger.debug(`onWeatherGet <- ${options.language}/${options.units}`);
  rememberPreferences(options, false);
  return provider.getWeather(options);
});

gladys.onWeatherGetImage(async (key) => {
  logger.debug(`onWeatherGetImage <- ${key}`);
  return provider.getImage(key);
});

// --- Dashboard widgets (Gladys 5.1+) ----------------------------------------
for (const [key, widget] of Object.entries(
  createWidgets({ provider, watcher, rememberPreferences }),
)) {
  gladys.onWidgetGet(key, (request) => widget.get(request));
}

// --- Scene actions -----------------------------------------------------------
for (const [key, handler] of Object.entries(
  createSceneActions({ watcher, provider, getPreferences: () => preferences }),
)) {
  gladys.onSceneAction(key, (fields) => handler(fields));
}

// --- Configuration screen buttons --------------------------------------------
for (const [key, handler] of Object.entries(createActions({ watcher, getConfig: () => config }))) {
  gladys.onAction(key, (fields) => handler(fields));
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated((newConfig) => {
  logger.info('Configuration updated');
  config = normalizeConfig(newConfig);
  // Alerts and images depend on it: start from scratch.
  provider.clear();
  gladys.requestWeatherRefresh();
  watcher.tick();
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    // The status shown in Gladys may be stale after a reconnection.
    lastStatus = undefined;
    // Nudges sent while disconnected were dropped: re-sync now.
    watcher.start();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  watcher.stop();
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  watcher.stop();
});

logger.info('Starting the Environment Canada integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
