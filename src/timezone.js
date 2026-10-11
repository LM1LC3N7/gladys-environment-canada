// -----------------------------------------------------------------------------
// UTC offset of a Canadian location (pure functions, no network).
//
// The ECCC city pages give every time in UTC and no time zone: the forecast
// periods ("Today", "Tonight") must still be dated in local time, and the
// widget prints local hours. The city page id names the province ("qc-147"),
// which, with the longitude for the provinces that straddle two zones, gives
// the IANA zone; Node's ICU data then gives the offset, daylight saving time
// included.
// -----------------------------------------------------------------------------

const PROVINCE_ZONES = {
  ab: 'America/Edmonton',
  bc: 'America/Vancouver',
  mb: 'America/Winnipeg',
  nb: 'America/Moncton',
  nl: 'America/St_Johns',
  ns: 'America/Halifax',
  nt: 'America/Yellowknife',
  nu: 'America/Iqaluit',
  on: 'America/Toronto',
  pe: 'America/Halifax',
  qc: 'America/Toronto',
  sk: 'America/Regina',
  yt: 'America/Whitehorse',
};

/**
 * IANA time zone of a location, from the province of its city page and its
 * coordinates. The borders are approximations: they only need to be right
 * for the places that have a city page.
 * @param {string} province two-letter code ("qc"), as in the city page id
 */
export function timeZoneOf(province, latitude, longitude) {
  const code = String(province ?? '').toLowerCase();
  switch (code) {
    case 'on':
      // Northwestern Ontario (Kenora, Dryden) lives on Central time.
      return longitude < -90 ? 'America/Winnipeg' : PROVINCE_ZONES.on;
    case 'qc':
      // The Magdalen Islands follow Atlantic time, the Lower North Shore
      // (Blanc-Sablon) Atlantic standard time all year.
      if (longitude > -60) {
        return 'America/Blanc-Sablon';
      }
      return latitude < 48 && longitude > -62.5 ? 'America/Halifax' : PROVINCE_ZONES.qc;
    case 'bc':
      // The Peace River area keeps Mountain standard time all year, the East
      // Kootenay (Cranbrook, Golden) follows Mountain time.
      if (latitude > 55.5 && longitude > -124) {
        return 'America/Dawson_Creek';
      }
      return latitude < 52.5 && longitude > -117.5 ? 'America/Edmonton' : PROVINCE_ZONES.bc;
    case 'sk':
      // Lloydminster straddles the Alberta border and follows Alberta.
      return longitude < -109.9 ? 'America/Edmonton' : PROVINCE_ZONES.sk;
    case 'nu':
      if (longitude < -102) {
        return 'America/Cambridge_Bay';
      }
      return longitude < -85 ? 'America/Rankin_Inlet' : PROVINCE_ZONES.nu;
    case 'nl':
      // Labrador lives on Atlantic time, the island on Newfoundland time.
      return latitude > 51.7 && longitude < -56 ? 'America/Goose_Bay' : PROVINCE_ZONES.nl;
    default:
      return PROVINCE_ZONES[code];
  }
}

/** Offset of a time zone at an instant, in minutes east of UTC. */
export function zoneOffsetMinutes(timeZone, instant = Date.now()) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(instant))
      .find((part) => part.type === 'timeZoneName')?.value;
    const match = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(name ?? '');
    if (!match) {
      return undefined;
    }
    if (!match[1]) {
      return 0;
    }
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === '-' ? -minutes : minutes;
  } catch {
    // An unknown zone (a runtime without ICU data): the caller falls back.
    return undefined;
  }
}

/**
 * UTC offset of a location at an instant: its time zone when the province is
 * known, else the solar offset of its longitude (a whole hour, no daylight
 * saving time).
 */
export function utcOffsetMinutes(province, latitude, longitude, instant = Date.now()) {
  const zone = timeZoneOf(province, latitude, longitude);
  return (zone && zoneOffsetMinutes(zone, instant)) ?? Math.round(longitude / 15) * 60;
}
