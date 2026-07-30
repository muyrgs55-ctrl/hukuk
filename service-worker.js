/* Muzo Hukuk — offline destegi
   Kendi dosyalarimiz: cache-first (internet olmadan da acilir)
   CDN ve fontlar: stale-while-revalidate (once cache, arkada guncelle)
*/

const VERSION = "muzo-hukuk-v1";
const CORE_CACHE = `${VERSION}-core`;
const VENDOR_CACHE = `${VERSION}-vendor`;

// Uygulamanin acilmasi icin sart olan dosyalar
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

// Disaridan gelen ama onbelleklenebilir kaynaklar
const VENDOR_HOSTS = [
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) =>
      // Tek dosya hata verirse kurulum comeksin diye tek tek ekliyoruz
      Promise.allSettled(CORE_ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" }))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Paylasim hedefi (?url=... ile gelen istek) -> her zaman index.html'i ver
  if (url.searchParams.has("url") || url.searchParams.has("text")) {
    event.respondWith(
      caches.match("./index.html").then((c) => c || fetch(req))
    );
    return;
  }

  // Sayfa gezinmeleri: once ag, olmazsa cache (navigation fallback)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CORE_CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((c) => c || caches.match("./")))
    );
    return;
  }

  // CDN / font: stale-while-revalidate
  if (VENDOR_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(VENDOR_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return cached || (await network) || new Response("", { status: 504, statusText: "Offline" });
      })
    );
    return;
  }

  // Kendi dosyalarimiz: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CORE_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => new Response("", { status: 504, statusText: "Offline" }));
      })
    );
  }
});
