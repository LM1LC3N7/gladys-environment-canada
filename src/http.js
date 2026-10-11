// -----------------------------------------------------------------------------
// The only place that talks to the network.
//
// Node 22+ provides `fetch`: no HTTP dependency. Every request carries the
// identifiable User-Agent and a timeout. The tests replace `fetch` with
// `setFetch()`, so no test ever reaches the network.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} on ${new URL(url).pathname}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function request(url, { timeout = HTTP_TIMEOUT, accept }) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    throw new HttpError(response.status, url);
  }
  return response;
}

export async function fetchJson(url, options = {}) {
  const response = await request(url, { ...options, accept: 'application/json' });
  return response.json();
}

export async function fetchBuffer(url, options = {}) {
  const response = await request(url, { ...options, accept: 'image/png' });
  const type = response.headers.get('content-type') ?? '';
  // A WMS server answers its errors with a 200 and an XML document.
  if (!type.startsWith('image/')) {
    throw new Error(`Expected an image, got "${type}" on ${new URL(url).pathname}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
