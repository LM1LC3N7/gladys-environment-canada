import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCityPage, parseDays } from '../src/sources/ecccCitypage.js';
import { alertSeverity, alertType, parseAlerts } from '../src/sources/ecccAlerts.js';
import { fixture } from './helpers/fakeFetch.js';

const page = fixture('eccc-citypage-montreal.json');
const NOW = Date.parse('2026-10-10T12:30:00Z');
const [lon, lat] = page.geometry.coordinates;

test('the city page becomes a snapshot in metric units', () => {
  const snapshot = parseCityPage(page, lat, lon, NOW);
  const cc = page.properties.currentConditions;
  assert.equal(snapshot.source, 'eccc');
  assert.equal(snapshot.station, 'Montréal');
  assert.equal(snapshot.cityId, 'qc-147');
  assert.equal(snapshot.utcOffsetMinutes, -240, 'Eastern daylight time in October');
  assert.equal(snapshot.current.temperature, cc.temperature.value.en);
  assert.equal(snapshot.current.pressure, cc.pressure.value.en * 10);
  assert.equal(snapshot.current.wind_speed, cc.wind.speed.value.en / 3.6);
  // The official wind chill is the apparent temperature.
  assert.equal(snapshot.current.apparent_temperature, cc.windChill.value.en);
  assert.equal(snapshot.current.pressure_change_3h, 2.9); // "rising" 0.29 kPa
  assert.equal(snapshot.hours.length, 24);
  // UV only by day.
  assert.ok(snapshot.hours.some((h) => Number.isFinite(h.uv_index)));
});

test('day and night periods are paired into dated days', () => {
  const days = parseDays(page.properties.forecastGroup, -240);
  assert.equal(days[0].date, '2026-10-10');
  assert.equal(days[0].temperature_max, 13);
  assert.equal(days[0].temperature_min, 9);
  assert.equal(days[1].date, '2026-10-11');
  for (let i = 1; i < days.length; i += 1) {
    assert.ok(days[i].date > days[i - 1].date);
  }
});

test('in winter the same city page is dated in Eastern standard time', () => {
  const january = Date.parse('2027-01-15T12:00:00Z');
  assert.equal(parseCityPage(page, lat, lon, january).utcOffsetMinutes, -300);
});

test('a forecast starting with "Tonight" begins on the next day', () => {
  const forecasts = page.properties.forecastGroup.forecasts.slice(1);
  const days = parseDays({ ...page.properties.forecastGroup, forecasts }, -240);
  assert.equal(days[0].date, '2026-10-11');
});

const alerts = fixture('eccc-alerts.json');
// Inside the "frost advisory" (continued) region of the fixture, near Québec.
const QUEBEC_AREA = { latitude: 46.8, longitude: -70.8 };

test('only the alerts whose polygon contains the house are kept', () => {
  const found = parseAlerts(alerts, QUEBEC_AREA.latitude, QUEBEC_AREA.longitude, NOW);
  assert.equal(found.length, 1);
  const [frost] = found;
  assert.equal(frost.code, 'FTA');
  assert.equal(frost.type, 'cold');
  assert.equal(frost.severity, 'moderate'); // yellow
  assert.equal(frost.event.fr, 'Avis de gel');
  assert.equal(frost.event.en, 'Frost advisory');
  assert.ok(frost.description.fr.length > 0);
  assert.ok(frost.end);
  assert.deepEqual(parseAlerts(alerts, 45.5, -73.57, NOW), []);
});

test('ended and expired alerts are dropped', () => {
  const ended = alerts.features.find((f) => f.properties.status_en === 'ended');
  const [lon0, lat0] = ended.geometry.coordinates[0][0];
  const inside = { latitude: lat0 + 0.01, longitude: lon0 + 0.01 };
  assert.deepEqual(parseAlerts(alerts, inside.latitude, inside.longitude, NOW), []);
  const later = Date.parse('2030-01-01T00:00:00Z');
  assert.deepEqual(parseAlerts(alerts, QUEBEC_AREA.latitude, QUEBEC_AREA.longitude, later), []);
});

test('alert types and severities', () => {
  const t = (en, fr = '') => alertType({ alert_name_en: en, alert_name_fr: fr });
  assert.equal(t('snowfall warning', 'avertissement de neige'), 'snow');
  assert.equal(t('freezing rain warning', 'avertissement de pluie verglaçante'), 'snow');
  assert.equal(t('rainfall warning', 'avertissement de pluie'), 'rain');
  assert.equal(t('wind warning', 'avertissement de vent'), 'wind');
  assert.equal(t('heat warning', 'avertissement de chaleur'), 'heat');
  assert.equal(t('extreme cold warning', 'avertissement de froid extrême'), 'cold');
  assert.equal(t('coastal flooding warning', 'avertissement de submersion côtière'), 'coastal');
  assert.equal(t('severe thunderstorm watch', "veille d'orages violents"), 'thunderstorm');
  assert.equal(t('fog advisory', 'avis de brouillard'), 'fog');
  assert.equal(t('special weather statement', 'bulletin météorologique spécial'), undefined);
  assert.equal(alertSeverity({ risk_colour_en: 'red' }), 'extreme');
  assert.equal(alertSeverity({ risk_colour_en: 'orange' }), 'severe');
  assert.equal(alertSeverity({ risk_colour_en: 'yellow' }), 'moderate');
  assert.equal(alertSeverity({ alert_type: 'statement' }), 'minor');
  assert.equal(alertSeverity({ alert_type: 'warning' }), 'moderate');
});
