const CACHE='sa-surf-v2.1.0';
const ASSETS=['./','./index.html','./styles.css?v=2.1.0','./app.js?v=2.1.0','./spots.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./assets/ocean.webp'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('sa-surf-')&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'){event.respondWith((async()=>{try{const r=await fetch(event.request);if(!r.ok)throw Error('HTTP');return r;}catch{return(await caches.open(CACHE)).match('./index.html');}})());return;}
 event.respondWith((async()=>{const c=await caches.open(CACHE);return await c.match(event.request)||fetch(event.request);})());
});
