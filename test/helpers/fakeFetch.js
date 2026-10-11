// -----------------------------------------------------------------------------
// Fake `fetch` for the tests: routes URLs to recorded fixtures, records every
// call, and fails loudly on an unexpected URL. No test touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const binary = (buffer, type = 'image/png') =>
  new Response(buffer, { status: 200, headers: { 'content-type': type } });

/**
 * Install a fake fetch. `routes` is a list of [pattern, handler]: the first
 * pattern (RegExp) matching the URL answers with handler(url, init).
 * Returns { calls, restore }.
 */
export function installFetch(routes) {
  const calls = [];
  const previous = setFetch(async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) {
      throw new Error(`Unexpected network call in a test: ${url}`);
    }
    return route[1](url, init);
  });
  return { calls, restore: () => setFetch(previous) };
}

/**
 * The Montréal city page, moved to another place (`at`) and changed by
 * `edit` when given.
 */
export function cityPageAt({ at, edit } = {}) {
  const page = fixture('eccc-citypage-montreal.json');
  if (at) {
    page.geometry.coordinates = [at.longitude, at.latitude];
  }
  edit?.(page.properties);
  return page;
}

// Routes answering Montréal from the recorded fixtures; `city` replaces the
// city page (see cityPageAt).
export function montrealRoutes(overrides = {}) {
  const cityPage = () => overrides.city ?? fixture('eccc-citypage-montreal.json');
  return [
    ...(overrides.routes ?? []),
    [
      /citypageweather-realtime\/items\?/,
      () => json({ type: 'FeatureCollection', features: [cityPage()] }),
    ],
    [/citypageweather-realtime\/items\//, () => json(cityPage())],
    [/weather-alerts\/items/, () => json(fixture('eccc-alerts.json'))],
    [/aqhi-stations\/items/, () => json(fixture('eccc-aqhi-stations-montreal.json'))],
    [
      /aqhi-observations-realtime\/items/,
      () => json(fixture('eccc-aqhi-observations-montreal.json')),
    ],
    [/aqhi-forecasts-realtime\/items/, () => json(fixture('eccc-aqhi-forecasts-montreal.json'))],
  ];
}

// The city page and the alerts were recorded on 2026-10-10 around 12:00 UTC;
// the AQHI answers on 2026-10-11 at 23:05 UTC, their times moved 35 hours
// back to match (see CLAUDE.md).
export const FIXTURE_NOW = Date.parse('2026-10-10T12:30:00Z');
export const MONTREAL = { latitude: 45.5017, longitude: -73.5673 };
