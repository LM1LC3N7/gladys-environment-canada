// -----------------------------------------------------------------------------
// Configuration screen buttons (manifest `actions`).
//
// `test_sources` asks each ECCC source once, bypassing the caches, for the
// first located house, and reports what answered: the quickest way to tell
// an API change at ECCC from a network problem.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { HTTP_TIMEOUT } from './constants.js';
import { isInCanadaArea } from './geo.js';
import { signed } from './i18n.js';
import { formatAqhi } from './aqhi.js';
import { fetchAlerts } from './sources/ecccAlerts.js';
import { findNearestCity, parseCityPage } from './sources/ecccCitypage.js';
import { fetchAirQuality, findNearestStation } from './sources/ecccAqhi.js';

const logger = createLogger({ name: 'actions' });

async function probe(label, task) {
  try {
    const detail = await task();
    return { ok: true, en: `${label.en}: OK${detail.en}`, fr: `${label.fr} : OK${detail.fr}` };
  } catch (err) {
    logger.warn(`${label.en} test failed: ${err.message}`);
    return {
      ok: false,
      en: `${label.en}: failed (${err.message})`,
      fr: `${label.fr} : échec (${err.message})`,
    };
  }
}

export function createActions({ watcher, getConfig, now = Date.now }) {
  return {
    async test_sources() {
      const house = watcher.findHouse();
      if (!house) {
        return {
          en: 'No location: place your house on the map in Gladys, then try again.',
          fr: 'Aucune position : placez votre maison sur la carte dans Gladys, puis réessayez.',
        };
      }
      const { latitude, longitude } = house;
      if (!isInCanadaArea(latitude, longitude)) {
        return {
          en: 'Your house is outside Canada: Environment Canada has no weather for it.',
          fr: 'Votre maison est hors du Canada : Environnement Canada n’a pas de météo pour elle.',
        };
      }
      const timeout = HTTP_TIMEOUT;
      const results = [
        await probe({ en: 'Forecasts', fr: 'Prévisions' }, async () => {
          const feature = await findNearestCity(latitude, longitude, { timeout });
          const snapshot = parseCityPage(feature, latitude, longitude, now());
          const t = `${signed(Math.round(snapshot.current.temperature))} °C`;
          return { en: ` (${snapshot.station}, ${t})`, fr: ` (${snapshot.station}, ${t})` };
        }),
      ];
      if (getConfig().official_alerts) {
        results.push(
          await probe({ en: 'Alerts', fr: 'Alertes' }, async () => {
            const n = (await fetchAlerts(latitude, longitude, { timeout, now: now() })).length;
            return { en: `, ${n} active`, fr: `, ${n} en cours` };
          }),
        );
      }
      results.push(
        await probe({ en: 'Air quality', fr: 'Qualité de l’air' }, async () => {
          const station = await findNearestStation(latitude, longitude, { timeout });
          if (!station) {
            return {
              en: ' (no AQHI community nearby)',
              fr: ' (aucune cote air santé à proximité)',
            };
          }
          const air = await fetchAirQuality(station, { timeout, now: now() });
          const value = formatAqhi(air?.current?.value);
          return {
            en: ` (${station.name.en}, AQHI ${value})`,
            fr: ` (${station.name.fr}, cote ${value})`,
          };
        }),
      );
      return {
        en: results.map((r) => r.en).join(' · '),
        fr: results.map((r) => r.fr).join(' · '),
      };
    },
  };
}
