// -----------------------------------------------------------------------------
// Integration configuration (manifest `config_schema`).
//
// The house coordinates are NOT configuration: Gladys sends them with every
// weather request, and the background loop reads them with getHouses().
// -----------------------------------------------------------------------------

// MUST stay consistent with the `default` values of the manifest
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  official_alerts: true,
  air_quality_alerts: false,
  feels_like_alerts: false,
  radar_image: true,
};

// A form may send "true"/"false" strings.
function bool(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  return fallback;
}

/** Merge the user config with the defaults, coercing the types. */
export function normalizeConfig(raw = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_CONFIG).map(([key, fallback]) => [key, bool(raw?.[key], fallback)]),
  );
}
