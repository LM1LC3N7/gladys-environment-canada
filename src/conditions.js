// -----------------------------------------------------------------------------
// ECCC weather icon codes -> conditions of the Gladys pivot enum: the
// documented icon codes of the city pages (00 to 48, see
// dd.weather.gc.ca/today/citypage_weather/docs/).
//
// A condition the source cannot tell apart is sent as the broader value
// (the doctrine of the pivot), and "night" is never sent: the real condition
// goes with `is_day: false`.
// -----------------------------------------------------------------------------

export const CONDITIONS = {
  CLEAR: 'clear',
  PARTLY_CLOUDY: 'partly-cloudy',
  CLOUD: 'cloud',
  FOG: 'fog',
  DRIZZLE: 'drizzle',
  RAIN: 'rain',
  POURING: 'pouring',
  SLEET: 'sleet',
  HAIL: 'hail',
  SNOW: 'snow',
  THUNDERSTORM: 'thunderstorm',
  WIND: 'wind',
  UNKNOWN: 'unknown',
  FREEZING_RAIN: 'freezing-rain',
  FREEZING_FOG: 'freezing-fog',
  SNOW_THUNDERSTORM: 'snow-thunderstorm',
  SANDSTORM: 'sandstorm',
  TORNADO: 'tornado',
  HURRICANE: 'hurricane',
};

const C = CONDITIONS;

const ECCC_ICONS = {
  0: C.CLEAR,
  1: C.PARTLY_CLOUDY,
  2: C.PARTLY_CLOUDY,
  3: C.CLOUD,
  4: C.CLOUD, // increasing cloudiness
  5: C.PARTLY_CLOUDY, // clearing
  6: C.RAIN,
  7: C.SLEET,
  8: C.SNOW,
  9: C.THUNDERSTORM,
  10: C.CLOUD,
  11: C.RAIN, // precipitation, squalls
  12: C.RAIN,
  13: C.RAIN,
  14: C.FREEZING_RAIN,
  15: C.SLEET,
  16: C.SNOW,
  17: C.SNOW,
  18: C.SNOW, // heavy snow, blizzard
  19: C.THUNDERSTORM,
  20: C.FOG,
  21: C.FOG,
  22: C.PARTLY_CLOUDY,
  23: C.FOG, // haze
  24: C.FOG,
  25: C.SNOW, // drifting snow
  26: C.SNOW, // ice crystals
  27: C.SLEET, // ice pellets
  28: C.DRIZZLE,
  29: C.UNKNOWN, // not available
  30: C.CLEAR,
  31: C.PARTLY_CLOUDY,
  32: C.PARTLY_CLOUDY,
  33: C.CLOUD,
  34: C.CLOUD,
  35: C.PARTLY_CLOUDY,
  36: C.RAIN,
  37: C.SLEET,
  38: C.SNOW,
  39: C.THUNDERSTORM,
  40: C.SNOW, // blowing snow
  41: C.TORNADO, // funnel cloud
  42: C.TORNADO,
  43: C.WIND,
  44: C.FOG, // smoke
  45: C.SANDSTORM, // dust storm, sandstorm
  46: C.HAIL, // thunderstorm with hail
  47: C.THUNDERSTORM, // thunderstorm with dust storm
  48: C.TORNADO, // waterspout
};

/**
 * Condition of an ECCC icon code. Fog at or below 0 °C is freezing fog
 * (supercooled droplets that glaze the roads): the pivot has a dedicated
 * value for it, the ECCC icons do not.
 */
export function ecccCondition(iconCode, temperature) {
  const condition = ECCC_ICONS[Number(iconCode)] ?? C.UNKNOWN;
  if (condition === C.FOG && Number.isFinite(temperature) && temperature <= 0) {
    return C.FREEZING_FOG;
  }
  return condition;
}

/** ECCC icon codes 30 to 39 are night-only drawings. */
export function ecccIsNightIcon(iconCode) {
  const code = Number(iconCode);
  return code >= 30 && code <= 39;
}
