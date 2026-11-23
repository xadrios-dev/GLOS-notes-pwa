/* GŁOS Notes PWA: cache only app shell, never transcriptions or API responses. */
const CACHE='glos-pwa-__BUILD_ID__';
const PREFIX='glos-pwa-';
const SHELL=[
  './','./index.html','./style.css','./dark.css','./design-system.css','./pwa.css',
  './theme.js','./pwa.js','./pwa-backup.js','./platform.js','./app.js',
  './library-search.js','./semantic-search.js','./sync-journal.js',
  './manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png',
  './vendor/markdown-it.min.js','./vendor/purify.min.js',
  './vendor/turndown.min.js','./vendor/jszip.min.js'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))
    .then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys
      .filter(key=>key.startsWith(PREFIX)&&key!==CACHE)
      .map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  const scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).catch(async()=>{
      const cache=await caches.open(CACHE);
      return await cache.match('./index.html')||
        new Response('GŁOS Notes jest chwilowo niedostępny.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }));
    return;
  }
  // Restrict interception to explicitly precached shell paths.
  const allowed=new Set(SHELL.map(path=>new URL(path,scope).pathname));
  if(!allowed.has(url.pathname))return;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(req)
    .then(hit=>hit||fetch(req))));
});
