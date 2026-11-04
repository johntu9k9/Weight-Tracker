// App-install files: manifest, service worker, and icons drawn on demand (plate ring on app green).
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const o = new Uint8Array(12 + data.length), v = new DataView(o.buffer);
  v.setUint32(0, data.length); for (let i = 0; i < 4; i++) o[4 + i] = type.charCodeAt(i);
  o.set(data, 8); v.setUint32(8 + data.length, crc(o.subarray(4, 8 + data.length))); return o;
};
const iconCache = {};
export async function makeIcon(n) {
  if (iconCache[n]) return iconCache[n];
  const bg = [47, 125, 91], c = n / 2, R = n * 0.29, w = n * 0.065, r2 = n * 0.13, S = 2;
  const raw = new Uint8Array(n * (n * 3 + 1));
  for (let y = 0; y < n; y++) {
    let o = y * (n * 3 + 1); raw[o++] = 0;
    for (let x = 0; x < n; x++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const d = Math.hypot(x + (sx + 0.5) / S - c, y + (sy + 0.5) / S - c);
        if ((d <= R && d >= R - w) || d <= r2) hit++;
      }
      const t = hit / (S * S);
      for (let k = 0; k < 3; k++) raw[o++] = Math.round(bg[k] + (255 - bg[k]) * t);
    }
  }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, n); dv.setUint32(4, n); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return (iconCache[n] = out);
}
export const MANIFEST = {"name": "Calorie Tracker", "short_name": "Calories", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "portrait", "background_color": "#f6f5f2", "theme_color": "#f6f5f2", "description": "Calorie, exercise and weight tracker", "icons": [{"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"}, {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]};
export const SW = `const CACHE = "ct-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
// Network-first so a new deploy shows up right away; the cached copy is only the offline fallback.
// /api/* is never cached: calorie data always comes live from the server.
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(r, c)); } return res; })
    .catch(() => caches.match(r).then((m) => m || caches.match("/"))));
});
`;
