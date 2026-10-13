# Environment Canada for Gladys Assistant

A **weather provider** external integration for
[Gladys Assistant](https://gladysassistant.com), fed by **Environment and
Climate Change Canada** (ECCC): the official forecasts and alerts, the **Air
Quality Health Index** (wildfire smoke included), the humidex in summer, the
wind chill in winter and the precipitation radar. No account, no key: the
open services of the Meteorological Service of Canada, for the location of
the house. Canada only.

> Not affiliated with nor endorsed by the Government of Canada.

> 🇫🇷 Documentation utilisateur en français : [`docs/fr.md`](docs/fr.md).
> User documentation in English: [`docs/en.md`](docs/en.md).

## Features

| Feature                                                                                          | Where                                         |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Current conditions, 24 hours, ~6 days in the Gladys pivot format (metric or US units), UV index  | `src/provider.js`, `src/pivot.js`             |
| Official ECCC alerts (CAP severities and types) + `requestWeatherRefresh()` when they change     | `src/sources/ecccAlerts.js`, `src/watcher.js` |
| Scene triggers "alert issued" / "alert ended" (house, levels 1–4, types), memory in `/data`      | `src/alertTracker.js`, `src/store.js`         |
| Scene action "current weather alerts": summary ready to send, levels now and later               | `src/scenes.js`                               |
| "Weather alerts" widget: levels now and later, period, badge, official text, minute clock        | `src/widgets.js`                              |
| "Air quality" widget: AQHI now and its risk level, 24-hour forecast, periods, smoke, advice      | `src/widgets.js`, `src/sources/ecccAqhi.js`   |
| Scene trigger "air quality level changed" (four Health Canada levels, one event per crossed one) | `src/sceneTriggers.js`, `src/aqhi.js`         |
| "Feels like" widget: humidex / wind chill, risk level, worst hour, time to frostbite             | `src/widgets.js`, `src/feelsLike.js`          |
| Scene trigger "feels-like level changed"                                                         | `src/sceneTriggers.js`                        |
| ECCC precipitation radar over an NRCan base map (provider image `radar`)                         | `src/sources/ecccRadar.js`                    |
| Muggy night, black ice risk, pressure trend in the widget                                        | `src/indicators.js`                           |
| Options: AQHI alerts and feels-like alerts (off by default)                                      | `src/assessment.js`                           |

## How it works

```
onWeatherGet(lat, lon, language, units)
  └─ WeatherProvider.getWeather
       ├─ getSnapshot (cache 10 min, shared in-flight promise)
       │    ├─ nearest ECCC city page (bbox search once a day, then by id)
       │    └─ last snapshot ≤ 3 h when it fails
       ├─ getAlerts (ECCC weather-alerts, cache 5 min, point-in-polygon)
       ├─ getAirQuality (only with the AQHI alerts option)
       └─ toPivot (metric snapshot -> requested units and language)

Watcher, every 5 min, per located house (getHouses, manifest location: true)
  ├─ alerts changed             -> requestWeatherRefresh(), requestWidgetRefresh('alerts')
  ├─ alert kind new / raised    -> publishSceneEvent('alert_issued'), memory in /data
  ├─ alert kind gone (confirmed)-> publishSceneEvent('alert_ended')
  ├─ feels-like level crossed   -> publishSceneEvent('feels_like_level_changed')
  ├─ AQHI level crossed         -> publishSceneEvent('air_quality_level_changed')
  └─ new data                   -> requestWidgetRefresh('feels_like' | 'air_quality')
```

Internally every value is kept in the pivot metric units (°C, m/s, hPa, mm,
km); the conversion to the unit system of the request happens last, so one
cache entry serves every user.

### Sources

| Source                                                          | Used for       | Notes                                                                                    |
| --------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `api.weather.gc.ca/collections/citypageweather-realtime`        | forecasts      | Nearest city page within 150 km (bbox search, then read by id, cached 24 h).             |
| `api.weather.gc.ca/collections/weather-alerts`                  | alerts         | One feature per (alert, region) polygon; colour → severity, name → type.                 |
| `api.weather.gc.ca/collections/aqhi-stations`                   | AQHI community | Nearest of ~130 communities, 75 km at most, cached 24 h.                                 |
| `api.weather.gc.ca/collections/aqhi-observations-realtime`      | AQHI now       | Hourly, decimals; some communities have none (Montréal, Québec City): the forecast then. |
| `api.weather.gc.ca/collections/aqhi-forecasts-realtime`         | AQHI forecast  | Twice a day: hourly values and named periods, with `aqhi_insmoke` in wildfire season.    |
| `geo.weather.gc.ca/geomet` (`RADAR_1KM_RRAI`, `RADAR_1KM_RSNO`) | radar          | One layer per request; composed with `pngjs`.                                            |
| `maps.geogratis.gc.ca/wms/CBMT`                                 | radar base map | NRCan "Canada Base Map – Transportation".                                                |

The city pages give every time in UTC and no time zone: `src/timezone.js`
derives it from the province of the city page id (`qc-147`) and the
longitude, and Node's ICU data gives the offset, daylight saving time
included. Conversions: wind km/h ÷ 3.6 → m/s, pressure kPa × 10 → hPa.
Conditions come from the documented ECCC icon codes (0–48); fog at or below
0 °C is sent as `freezing-fog`; `night` is never sent.

Feels-like formulas (pure functions, tested): ECCC humidex, JAG/TI 2001
wind chill (with ECCC's low-wind form under 5 km/h), Magnus dew point when
the hourly forecast omits it. Sunrise and sunset are computed locally.

## Development

```bash
npm install
npm test                 # node --test, no network (fetch is faked, fixtures in test/fixtures)
npm run lint             # ESLint
npm run format:check     # Prettier
npm run audit            # npm audit of the production dependencies
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="<selector>" \
LOG_LEVEL=debug npm start
```

The fixtures were recorded from the live APIs (see [`CLAUDE.md`](CLAUDE.md)
to refresh them).

## Release

Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md),
then **Actions → Release → Run workflow** (`patch` / `minor` / `major`): it
bumps the versions, tags, builds the multi-arch image to
`ghcr.io/lm1lc3n7/gladys-environment-canada` and publishes the GitHub
Release. Publishing in the store = the GitHub topic
`gladys-assistant-integration`.

## Licence

Apache-2.0 (the code). Data: Environment and Climate Change Canada, under the
[ECCC Data Servers End-use Licence](https://eccc-msc.github.io/open-data/licence/readme_en/)
("Data Source: Environment and Climate Change Canada"); radar base map:
Natural Resources Canada, under the Open Government Licence – Canada. See
[`NOTICE`](NOTICE).
