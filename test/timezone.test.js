import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeZoneOf, utcOffsetMinutes, zoneOffsetMinutes } from '../src/timezone.js';

const SUMMER = Date.parse('2026-07-01T12:00:00Z');
const WINTER = Date.parse('2027-01-15T12:00:00Z');

test('each province has its time zone', () => {
  assert.equal(timeZoneOf('qc', 45.5, -73.57), 'America/Toronto');
  assert.equal(timeZoneOf('ON', 43.65, -79.38), 'America/Toronto');
  assert.equal(timeZoneOf('mb', 49.9, -97.14), 'America/Winnipeg');
  assert.equal(timeZoneOf('sk', 50.45, -104.6), 'America/Regina');
  assert.equal(timeZoneOf('ab', 51.05, -114.07), 'America/Edmonton');
  assert.equal(timeZoneOf('bc', 49.28, -123.12), 'America/Vancouver');
  assert.equal(timeZoneOf('ns', 44.65, -63.57), 'America/Halifax');
  assert.equal(timeZoneOf('nl', 47.56, -52.71), 'America/St_Johns');
  assert.equal(timeZoneOf('yt', 60.72, -135.05), 'America/Whitehorse');
  assert.equal(timeZoneOf('xx', 45, -73), undefined);
});

test('the provinces that straddle two zones', () => {
  assert.equal(timeZoneOf('on', 49.77, -94.49), 'America/Winnipeg', 'Kenora');
  assert.equal(timeZoneOf('on', 48.38, -89.25), 'America/Toronto', 'Thunder Bay');
  assert.equal(timeZoneOf('qc', 47.38, -61.86), 'America/Halifax', 'Magdalen Islands');
  assert.equal(timeZoneOf('qc', 51.43, -57.13), 'America/Blanc-Sablon');
  assert.equal(timeZoneOf('bc', 56.25, -120.85), 'America/Dawson_Creek', 'Fort St. John');
  assert.equal(timeZoneOf('bc', 49.51, -115.77), 'America/Edmonton', 'Cranbrook');
  assert.equal(timeZoneOf('sk', 53.28, -110.0), 'America/Edmonton', 'Lloydminster');
  assert.equal(timeZoneOf('nu', 63.75, -68.52), 'America/Iqaluit');
  assert.equal(timeZoneOf('nu', 62.81, -92.09), 'America/Rankin_Inlet');
  assert.equal(timeZoneOf('nu', 69.12, -105.06), 'America/Cambridge_Bay');
  assert.equal(timeZoneOf('nl', 53.3, -60.4), 'America/Goose_Bay', 'Labrador');
});

test('offsets follow daylight saving time, where there is one', () => {
  assert.equal(zoneOffsetMinutes('America/Toronto', SUMMER), -240);
  assert.equal(zoneOffsetMinutes('America/Toronto', WINTER), -300);
  assert.equal(zoneOffsetMinutes('America/Regina', SUMMER), -360);
  assert.equal(zoneOffsetMinutes('America/Regina', WINTER), -360);
  assert.equal(zoneOffsetMinutes('America/St_Johns', WINTER), -210);
  assert.equal(zoneOffsetMinutes('UTC', WINTER), 0);
  assert.equal(zoneOffsetMinutes('Not/AZone', WINTER), undefined);
});

test('an unknown province falls back on the solar offset', () => {
  assert.equal(utcOffsetMinutes('qc', 45.5, -73.57, SUMMER), -240);
  assert.equal(utcOffsetMinutes(undefined, 45.5, -73.57, SUMMER), -300);
});
