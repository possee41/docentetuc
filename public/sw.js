const CACHE = "docentetuc-v4";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.png", "/icon-192.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let message;
  try { message = event.data.json(); } catch { message = { title: "DocenteTuc", body: event.data.text(), url: "/" }; }
  event.waitUntil(self.registration.showNotification(message.title || "DocenteTuc", {
    body: message.body || "Tenés una nueva alerta docente.",
    icon: "/icon-192.png",
    badge: "/favicon.png",
    tag: message.tag,
    data: { url: message.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const current = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (current) { if ("navigate" in current) await current.navigate(target); return current.focus(); }
    return self.clients.openWindow(target);
  }));
});
