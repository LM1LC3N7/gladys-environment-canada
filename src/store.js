// -----------------------------------------------------------------------------
// Small JSON files in /data, the only writable place of the container: what
// the alert triggers last saw per house (alerts.json), so a restart neither
// fires again the alerts already announced nor forgets the ones issued
// meanwhile. Best effort: a read or write failure is logged, never thrown.
// House coordinates are never written.
//
// Locally, ECCC_DATA_DIR points the store at any folder.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export function defaultDataDir() {
  return process.env.ECCC_DATA_DIR || '/data';
}

export function createStore(dir = defaultDataDir()) {
  return {
    dir,
    load(name) {
      try {
        return JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Could not read ${name}: ${err.message}`);
        }
        return null;
      }
    },
    save(name, value) {
      try {
        mkdirSync(dir, { recursive: true });
        // Write then rename: a crash mid-write never leaves half a file.
        const file = path.join(dir, name);
        writeFileSync(`${file}.tmp`, JSON.stringify(value));
        renameSync(`${file}.tmp`, file);
      } catch (err) {
        logger.warn(`Could not write ${name}: ${err.message}`);
      }
    },
  };
}

/** An in-memory store (tests, and a container without /data). */
export function createMemoryStore() {
  const files = new Map();
  return {
    dir: null,
    files,
    load: (name) => (files.has(name) ? JSON.parse(files.get(name)) : null),
    save: (name, value) => files.set(name, JSON.stringify(value)),
  };
}
