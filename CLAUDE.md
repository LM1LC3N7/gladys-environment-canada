# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `weather`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.14). It
answers `onWeatherGet` with the pivot weather format (contract B.18 of the
Gladys spec `docs/specs/external-integrations/capabilities/weather-type.md`)
from **Environment and Climate Change Canada** only, and adds two dashboard
widgets ("Air quality", "Feels like") and two scene triggers. Derived from
`gladys-meteomedia` (same author), MétéoMédia removed: no key, no account,
publishable in the store.

A weather integration has **no device screen** (store schema): the Air
Quality Health Index lives in a widget, a scene trigger and an optional
alert, not in a device.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/provider.test.js         # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js                    SDK wiring only (handlers registered before connect())
src/provider.js             caches, city page, alerts, air quality, images -> pivot
src/pivot.js                metric snapshot -> pivot (units, language, limits)
src/sources/ecccCitypage.js ECCC city pages -> snapshot
src/sources/ecccAlerts.js   ECCC weather alerts -> bilingual alerts
src/sources/ecccAqhi.js     ECCC AQHI communities, observations, forecasts
src/sources/ecccRadar.js    radar PNG (GeoMet + NRCan base map, pngjs)
src/timezone.js             province + longitude -> IANA zone -> UTC offset (pure)
src/aqhi.js                 AQHI levels, advice, hysteresis (pure)
src/feelsLike.js            humidex, wind chill, levels (pure)
src/assessment.js           feels-like index of a snapshot, synthetic alerts
src/indicators.js           muggy night, black ice, pressure trend (pure)
src/sun.js                  sunrise/sunset, day/night (pure)
src/conditions.js           ECCC icon codes -> pivot conditions
src/watcher.js              5-min loop: alerts nudge, scene events, widget nudges
src/sceneTriggers.js        feels-like and AQHI level trackers (baseline, hysteresis)
src/widgets.js              "feels_like" and "air_quality" widget contents
src/actions.js              "test_sources" button
src/i18n.js                 runtime texts (fr/en)
test/fixtures/              recorded API answers
test/helpers/fakeFetch.js   fake fetch: tests never touch the network
```

A **snapshot** is the source-independent internal model: always metric
pivot units (°C, m/s, hPa, mm, km), no language. Conversions to the request
happen only in `src/pivot.js` (and in the widget / scene texts).

## What is known of the ECCC data

- **City pages** (`citypageweather-realtime`, marked experimental by ECCC):
  every time is UTC, no time zone, no visibility, no hourly precipitation
  amount. The id is `<province>-<n>` ("qc-147"): `src/timezone.js` turns the
  province (and the longitude where a province straddles two zones) into an
  IANA zone. The periods ("Today", "Tonight") carry no date: `parseDays`
  dates them from the issue time in that local time.
- **AQHI** (checked 2026-10-11): 134 communities (`aqhi-stations`, id like
  "EHHUN"). Observations are hourly with decimals (2.12), `latest=true`
  filters the last one; Montréal (EHHUN) and Québec (EHTWR) have forecasts
  but no observation. Forecasts come twice a day (10:00 and 21:00 UTC): one
  record per hour plus one "AQHI-Forecast-Period" record whose
  `forecast_period.period_N` hold a bilingual name, `aqhi` and
  `aqhi_insmoke` (null outside the wildfire season; never seen filled yet).
- **Alerts**: special air quality statements come through `weather-alerts`
  like the others; no pivot `type` fits them, they go untyped.
- **Licence**: ECCC Data Servers End-use Licence: attribution "Data Source:
  Environment and Climate Change Canada", never suggest an endorsement,
  never use ECCC logos (see NOTICE).

## Rules

- **Keys are forever**: manifest `config_schema`, `actions`, widget,
  scene-trigger and level keys (`cold_high`, `very_high`…) are stored in
  user scenes and dashboards. Never rename them.
- **Gladys awaits `onWeatherGet` under 15 s**: keep the timeout in
  `src/constants.js` (5 s per call) and the caches.
- **The air quality alert has one event text** whatever the level: the core
  keys its alert diff on the event of an untyped alert.
- **Widget texts are bounded**: a `body` text holds 300 characters (the AQHI
  advice is tested against it), a `caption` 80, a status label 40.
- **Read-only rootfs**: write nothing outside `/data` (we write nothing).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code. `source: "houses"` is refused by the store schema:
  houses are matched by name.
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (`installFetch` throws on an unknown URL)
  and take their clock from `FIXTURE_NOW`: pass `now` down to every parser
  that compares with the current time.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
- The Docker image cannot be built in the Claude Code cloud container (no
  network for `apk` inside `docker build`): the CI builds it.

## Refreshing the fixtures

```bash
B=https://api.weather.gc.ca/collections
curl -s "$B/citypageweather-realtime/items/qc-147?f=json" \
  | python3 -m json.tool --indent 1 > test/fixtures/eccc-citypage-montreal.json
curl -s "$B/aqhi-stations/items?f=json&limit=100&bbox=-74.5,45,-72.5,46" > test/fixtures/eccc-aqhi-stations-montreal.json
for c in montreal:EHHUN toronto:FDQBU; do
  curl -s "$B/aqhi-observations-realtime/items?f=json&location_id=${c#*:}&latest=true" > test/fixtures/eccc-aqhi-observations-${c%:*}.json
  curl -s "$B/aqhi-forecasts-realtime/items?f=json&location_id=${c#*:}&sortby=-publication_datetime&limit=80" > test/fixtures/eccc-aqhi-forecasts-${c%:*}.json
done
```

The city page and `eccc-alerts.json` (real alert properties, polygons
simplified to bounding boxes) were recorded on 2026-10-10 around 12:00 UTC;
the AQHI files on 2026-10-11 at 23:05 UTC, every date in them (and in their
ids) moved 35 hours back to match `FIXTURE_NOW` (2026-10-10T12:30Z, in
`test/helpers/fakeFetch.js`); their `*_text_*` fields keep the original
times. After a refresh, align `FIXTURE_NOW` and the dates the same way.
