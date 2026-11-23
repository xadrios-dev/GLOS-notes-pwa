/* Install UX, PWA lifecycle and storage-awareness for iOS Safari. */
(()=>{
  'use strict';
  const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone===true;
  const isiOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const state={standalone:isStandalone(),ios:isiOS(),ready:false,offline:!navigator.onLine};
  window.GlosPWA={
    getStatus:()=>({...state}),
    isStandalone,
    async requestPersistentStorage(){
      if(!navigator.storage?.persist)return false;
      return navigator.storage.persist();
    },
    async estimateStorage(){
      if(!navigator.storage?.estimate)return null;
      return navigator.storage.estimate();
    }
  };
  const sync=()=>{
    state.offline=!navigator.onLine;
    document.documentElement.classList.toggle('pwa-offline',state.offline);
    document.documentElement.classList.toggle('pwa-standalone',isStandalone());
    document.querySelector('#pwa-status-live')?.replaceChildren(
      document.createTextNode(state.offline?'Offline: notatki i nagrywanie lokalne':'Online')
    );
  };
  window.addEventListener('online',sync);
  window.addEventListener('offline',sync);
  sync();
  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'})
      .then(reg=>{
        state.ready=true;
        reg.update().catch(()=>{});
        navigator.serviceWorker.addEventListener('controllerchange',()=>{
          window.dispatchEvent(new CustomEvent('glos-pwa-updated'));
        });
      })
      .catch(err=>console.warn('PWA offline cache unavailable:',err));
  });
})();
