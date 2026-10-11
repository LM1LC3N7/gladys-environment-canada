import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  RADAR_HEIGHT,
  RADAR_WIDTH,
  blend,
  buildRadarImage,
  drawMarker,
} from '../src/sources/ecccRadar.js';
import { binary, installFetch } from './helpers/fakeFetch.js';

let fake;
afterEach(() => fake?.restore());

function solid(rgba, width = RADAR_WIDTH, height = RADAR_HEIGHT) {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data.set(rgba, i);
  }
  return image;
}

const pixel = (image, x, y) => [
  ...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
];

test('a transparent layer leaves the base untouched, an opaque one blends', () => {
  const base = solid([200, 200, 200, 255], 2, 1);
  const layer = new PNG({ width: 2, height: 1 });
  layer.data.set([0, 0, 0, 0, 0, 0, 255, 255]);
  blend(base, layer, 0.5);
  assert.deepEqual(pixel(base, 0, 0), [200, 200, 200, 255]);
  assert.deepEqual(pixel(base, 1, 0), [100, 100, 228, 255]);
});

test('the house marker is drawn in the middle', () => {
  const image = solid([255, 255, 255, 255]);
  drawMarker(image);
  assert.deepEqual(pixel(image, RADAR_WIDTH / 2, RADAR_HEIGHT / 2), [220, 38, 38, 255]);
  assert.deepEqual(pixel(image, 0, 0), [255, 255, 255, 255]);
});

test('the composed image is a PNG under 500 KB, with the house marker', async () => {
  const base = PNG.sync.write(solid([240, 240, 240, 255]));
  const rain = PNG.sync.write(solid([0, 0, 0, 0]));
  fake = installFetch([
    [/geogratis/, () => binary(base)],
    [/geomet/, () => binary(rain)],
  ]);
  const b64 = await buildRadarImage(45.5, -73.57);
  const png = Buffer.from(b64, 'base64');
  assert.ok(png.length < 500 * 1024);
  const image = PNG.sync.read(png);
  assert.equal(image.width, RADAR_WIDTH);
  assert.deepEqual(pixel(image, RADAR_WIDTH / 2, RADAR_HEIGHT / 2), [220, 38, 38, 255]);
  assert.deepEqual(pixel(image, 10, 10), [240, 240, 240, 255]);
  // Same bbox for the base map and the two radar layers.
  const bboxes = new Set(fake.calls.map((c) => new URL(c.url).searchParams.get('bbox')));
  assert.equal(bboxes.size, 1);
  assert.equal(fake.calls.length, 3);
});

test('a missing base map still gives a radar; no radar layer at all is an error', async () => {
  const rain = PNG.sync.write(solid([0, 0, 255, 255]));
  fake = installFetch([
    [/geogratis/, () => new Response('down', { status: 503 })],
    [/geomet/, () => binary(rain)],
  ]);
  assert.ok(await buildRadarImage(45.5, -73.57));
  fake.restore();
  fake = installFetch([
    [/geogratis/, () => binary(PNG.sync.write(solid([1, 1, 1, 255])))],
    // GeoMet answers its errors with a 200 and an XML document.
    [/geomet/, () => binary(Buffer.from('<ServiceExceptionReport/>'), 'text/xml')],
  ]);
  await assert.rejects(buildRadarImage(45.5, -73.57), /Expected an image/);
});
