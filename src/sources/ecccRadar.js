// -----------------------------------------------------------------------------
// Precipitation radar image (ECCC GeoMet WMS) over a base map (NRCan).
//
// GeoMet serves the radar layers alone (transparent PNG) and refuses several
// layers in one request, and has no base map: the image is composed here —
// NRCan "Canada Base Map – Transportation" (CBMT), then the rain and snow
// radar layers at 65 % opacity, then a marker on the house.
//
// Licences: ECCC data and NRCan base map, Open Government Licence – Canada.
// -----------------------------------------------------------------------------

import { PNG } from 'pngjs';
import { ECCC_GEOMET_URL, NRCAN_BASEMAP_URL } from '../constants.js';
import { fetchBuffer } from '../http.js';
import { mercatorBbox } from '../geo.js';

export const RADAR_WIDTH = 600;
export const RADAR_HEIGHT = 400;
// 300 km × 200 km around the house: a few hours of incoming precipitation.
const HALF_WIDTH_KM = 150;
const HALF_HEIGHT_KM = 100;
const RADAR_LAYERS = ['RADAR_1KM_RRAI', 'RADAR_1KM_RSNO'];
const RADAR_OPACITY = 0.65;
const BACKGROUND = [242, 239, 233];
const MARKER = [220, 38, 38];
// Gladys refuses an image over 500 KB.
export const MAX_IMAGE_BYTES = 500 * 1024;

function wmsUrl(base, layer, bbox, transparent) {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: layer,
    styles: '',
    crs: 'EPSG:3857',
    bbox: bbox.join(','),
    width: String(RADAR_WIDTH),
    height: String(RADAR_HEIGHT),
    format: 'image/png',
  });
  if (transparent) {
    params.set('transparent', 'true');
  }
  return `${base}?${params}`;
}

function blank() {
  const image = new PNG({ width: RADAR_WIDTH, height: RADAR_HEIGHT });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data.set([...BACKGROUND, 255], i);
  }
  return image;
}

function decode(buffer) {
  const image = PNG.sync.read(buffer);
  if (image.width !== RADAR_WIDTH || image.height !== RADAR_HEIGHT) {
    throw new Error(`Unexpected layer size ${image.width}×${image.height}`);
  }
  return image;
}

/** Alpha-blend `layer` over `base` in place (both RGBA, same size). */
export function blend(base, layer, opacity = 1) {
  for (let i = 0; i < base.data.length; i += 4) {
    const alpha = (layer.data[i + 3] / 255) * opacity;
    if (alpha === 0) {
      continue;
    }
    for (let c = 0; c < 3; c += 1) {
      base.data[i + c] = Math.round(layer.data[i + c] * alpha + base.data[i + c] * (1 - alpha));
    }
    base.data[i + 3] = 255;
  }
}

/** A ring on the house, in the middle of the image. */
export function drawMarker(image) {
  const cx = RADAR_WIDTH / 2;
  const cy = RADAR_HEIGHT / 2;
  for (let y = cy - 8; y <= cy + 8; y += 1) {
    for (let x = cx - 8; x <= cx + 8; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      const color = d <= 3 ? MARKER : d >= 5.5 && d <= 7.5 ? [255, 255, 255] : undefined;
      if (color) {
        image.data.set([...color, 255], (y * RADAR_WIDTH + x) * 4);
      }
    }
  }
}

/**
 * Compose the radar image of a location.
 * @returns {Promise<string>} raw base64 of a PNG (no data URI prefix)
 */
export async function buildRadarImage(latitude, longitude, { timeout } = {}) {
  const bbox = mercatorBbox(latitude, longitude, HALF_WIDTH_KM, HALF_HEIGHT_KM);
  const [basemap, ...layers] = await Promise.allSettled([
    fetchBuffer(wmsUrl(NRCAN_BASEMAP_URL, 'CBMT', bbox, false), { timeout }).then(decode),
    ...RADAR_LAYERS.map((layer) =>
      fetchBuffer(wmsUrl(ECCC_GEOMET_URL, layer, bbox, true), { timeout }).then(decode),
    ),
  ]);
  const radars = layers.filter((l) => l.status === 'fulfilled').map((l) => l.value);
  if (radars.length === 0) {
    throw layers[0].reason;
  }
  // No base map is still a usable radar: plain background.
  const image = basemap.status === 'fulfilled' ? basemap.value : blank();
  for (const radar of radars) {
    blend(image, radar, RADAR_OPACITY);
  }
  drawMarker(image);
  const png = PNG.sync.write(image, { colorType: 2 });
  if (png.length > MAX_IMAGE_BYTES) {
    throw new Error(`Radar image too large (${png.length} bytes)`);
  }
  return png.toString('base64');
}
