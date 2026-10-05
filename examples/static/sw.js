// VERIFIED: skipWaiting + clients.claim make the first page load controlled without a reload; the native probe
// fixture uses the same pair and passed worker_controls_client in its first run.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
