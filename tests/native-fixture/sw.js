self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(new URL(event.request.url).pathname.endsWith('/__worker_fetch__'))event.respondWith(new Response('native-worker-v1',{headers:{'Content-Type':'text/plain'}}));});
