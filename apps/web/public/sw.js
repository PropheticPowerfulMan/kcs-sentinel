const CACHE_NAME = "kcs-sentinel-shell-v13-standalone";
const BASE_PATH = self.registration.scope;
const toScopedPath = (path) => new URL(path, BASE_PATH).toString();
const APP_SHELL = [
  toScopedPath("./"),
  toScopedPath("./manifest.webmanifest"),
  toScopedPath("./images/sentinel-secure-campus-hero.png"),
  toScopedPath("./icons/kcs-logo.jpg"),
  toScopedPath("./icons/favicon-16.png"),
  toScopedPath("./icons/favicon-32.png"),
  toScopedPath("./icons/apple-touch-icon.png"),
  toScopedPath("./icons/icon-192.png"),
  toScopedPath("./icons/icon-512.png"),
  toScopedPath("./icons/icon-maskable-512.png")
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("kcs-sentinel-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }

          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(event.request);
          return cachedPage ?? caches.match(toScopedPath("./"));
        })
    );
    return;
  }

  const isCodeAsset = ["script", "style", "worker"].includes(event.request.destination);
  if (isCodeAsset) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then((response) => {
          if (!response.ok || !event.request.url.startsWith(self.location.origin)) {
            return response;
          }

          const clone = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(toScopedPath("./")));
    })
  );
});
