import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function resolveDomToPptxBrowserBundle(): string {
  const packageEntryPath = require.resolve('dom-to-pptx');
  return resolve(dirname(packageEntryPath), 'dom-to-pptx.bundle.js');
}

// Serve the dom-to-pptx browser bundle from node_modules at a stable path
// so the internal export page can load it without external CDN dependencies.
export default defineEventHandler(async (event) => {
  const bundlePath = resolveDomToPptxBrowserBundle();

  setResponseHeader(event, 'Content-Type', 'application/javascript; charset=utf-8');
  // Cache the bundle for 1 hour — it only changes when we upgrade dom-to-pptx
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600, immutable');

  return sendStream(event, createReadStream(bundlePath));
});
