// Runs the JavaScript packing engine off the main thread.
import { packRequest } from './engine.js';

self.onmessage = (e) => {
  const { id, catalog, request } = e.data;
  try {
    const layout = packRequest(catalog, request, (attempts) => self.postMessage({ id, progress: attempts }));
    self.postMessage({ id, layout });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
