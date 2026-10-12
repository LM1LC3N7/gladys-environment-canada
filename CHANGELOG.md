# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- "Air quality" widget: the advice for the vulnerable people reads "People
  at risk:" instead of "At risk:", which read as if the air itself were a
  risk at a low index.

## [0.1.0] - 2026-10-11

### Added

- Environment Canada weather provider: the forecasts of the nearest ECCC city
  page (current conditions, 24 hours, about 6 days, UV index) in the Gladys
  pivot format, metric and US units, dated in the local time of the house
  (time zone from the province, daylight saving time included).
- Official Environment Canada alerts, with a refresh request to Gladys when
  they change (the core "weather alert" scene trigger fires within minutes).
- "Air quality" dashboard widget: the Air Quality Health Index of the nearest
  community, its risk level and the Health Canada advice, the 24-hour
  forecast, the forecast periods and the index expected in wildfire smoke.
- "Air quality level changed" scene trigger, one event per crossed level.
- Optional air quality alert from a high AQHI (off by default).
- "Feels like" dashboard widget and "feels-like level changed" scene trigger
  (humidex, wind chill, time to frostbite, black ice, muggy night, pressure
  trend), and optional feels-like alerts (off by default).
- Environment Canada precipitation radar as a provider image.
- "Test Environment Canada" button in the Configuration screen.

[Unreleased]: https://github.com/LM1LC3N7/gladys-environment-canada/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LM1LC3N7/gladys-environment-canada/releases/tag/v0.1.0
