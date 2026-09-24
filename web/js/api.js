// Backend adapter. With `python app.py` the page talks to the Python server
// (packing, saved trips on disk). Opened as a plain web page (e.g. hosted),
// it packs with the JavaScript engine in a Web Worker and keeps saved trips
// in this browser.

const TRIPS_KEY = 'spa-trips-v1';

export async function connect() {
  try {
    const res = await fetch('api/catalog', { cache: 'no-store' });
    if (res.ok) {
      const catalog = await res.json();
      if (catalog && catalog.server) return serverBackend(catalog);
    }
  } catch { /* no server: fall through */ }
  const res = await fetch('data/catalog.json');
  if (!res.ok) throw new Error('Could not load the item catalog');
  return localBackend(await res.json());
}

function serverBackend(catalog) {
  const json = async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };
  return {
    mode: 'server',
    catalog,
    pack: (body) => fetch('api/pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
    listTrips: () => fetch('api/trips', { cache: 'no-store' }).then(json),
    saveTrip: (trip) => fetch('api/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trip) }).then(json),
    deleteTrip: (id) => fetch(`api/trips/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(json),
  };
}

function localBackend(catalog) {
  let worker = null;
  let seq = 0;
  const pending = new Map();
  try {
    worker = new Worker(new URL('./packer/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, layout, error, progress } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress !== undefined) { p.onProgress?.(progress); return; }
      pending.delete(id);
      if (error) p.reject(new Error(error)); else p.resolve(layout);
    };
    worker.onerror = () => { worker = null; };
  } catch { worker = null; }

  const memory = { trips: [] };
  const readTrips = () => {
    try { return JSON.parse(localStorage.getItem(TRIPS_KEY) || '[]'); } catch { return memory.trips; }
  };
  const writeTrips = (trips) => {
    memory.trips = trips;
    try { localStorage.setItem(TRIPS_KEY, JSON.stringify(trips)); } catch { /* memory only */ }
  };

  return {
    mode: 'browser',
    catalog,
    async pack(body, onProgress) {
      if (worker) {
        const id = ++seq;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject, onProgress });
          worker.postMessage({ id, catalog, request: body });
        });
      }
      const { packRequest } = await import('./packer/engine.js');
      await new Promise((r) => setTimeout(r, 30)); // let the spinner paint first
      return packRequest(catalog, body);
    },
    async listTrips() { return readTrips(); },
    async saveTrip(trip) {
      const name = String(trip.name || '').trim().slice(0, 60);
      if (!name) throw new Error('A saved trip needs a name.');
      const clean = { ...trip, name, id: trip.id || Math.random().toString(36).slice(2, 12), saved_at: Math.floor(Date.now() / 1000) };
      writeTrips([clean, ...readTrips().filter((t) => t.id !== clean.id && t.name !== name)].slice(0, 100));
      return clean;
    },
    async deleteTrip(id) {
      writeTrips(readTrips().filter((t) => t.id !== id));
      return { deleted: true };
    },
  };
}
