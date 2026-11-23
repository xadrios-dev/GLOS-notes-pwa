/* GŁOS: storage and platform bridge. No third-party JS runtime required. */
(() => {
  'use strict';
  const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('glos_notes_v2', 6);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('semantic_index')) db.createObjectStore('semantic_index', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sync_meta')) db.createObjectStore('sync_meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sync_revisions')) db.createObjectStore('sync_revisions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sync_outbox')) db.createObjectStore('sync_outbox', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = async (store, mode, fn) => {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        let result;
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error||Error('Błąd bazy danych.'));
        transaction.onabort = () => reject(transaction.error||Error('Zapis bazy przerwany.'));
        try{
          const request=fn(transaction.objectStore(store));
          request.onsuccess=()=>{result=request.result};
        }catch(err){try{transaction.abort()}catch{}reject(err);}
      });
    } finally { db.close(); }
  };
  const journal=()=>{
    if(!window.GlosSyncJournal)throw Error('Brakuje modułu dziennika synchronizacji.');
    return window.GlosSyncJournal;
  };
  const withDb=async fn=>{
    const db=await openDb();
    try{return await fn(db)}finally{db.close();}
  };
  const native = () => window.Capacitor?.Plugins?.GlosNative || null;
  // GlosNative is Kotlin-only. On iOS use supported web paths instead of
  // attempting to call the missing Android Capacitor plugin.
  const currentPlatform = () => window.Capacitor?.getPlatform?.() ||
    (window.Capacitor?.isNativePlatform?.() ? 'android' : 'web');
  const isIOS = () => currentPlatform()==='ios' && !!window.Capacitor?.isNativePlatform?.();
  const isNative = () => currentPlatform()==='android' && !!window.Capacitor?.isNativePlatform?.();
  let mediaRecorder = null;
  let audioStream = null;
  let chunks = [];
  let webStartedAt = 0;
  let pausedAt = 0;
  let pausedTotal = 0;
  let activeNoteId = null;
  const invoke = async (method, args={}) => {
    const plugin = native();
    if (plugin && typeof plugin[method] === 'function') return plugin[method](args);
    // Fallback to Capacitor's native bridge for locally registered plugins.
    if (isNative() && typeof window.Capacitor?.nativePromise === 'function')
      return window.Capacitor.nativePromise('GlosNative', method, args);
    throw new Error('Funkcja natywna nie jest dostępna. Uruchom aplikację jako APK.');
  };
  const fileUrl = path => {
    if (!path) return '';
    if (isNative() && typeof window.Capacitor?.convertFileSrc === 'function') {
      return window.Capacitor.convertFileSrc(path.startsWith('file://') ? path : `file://${path}`);
    }
    return path;
  };
  const platform = {
    isNative,
    isIOS,
    notes: {
      async all() { return (await tx('notes','readonly',s=>s.getAll())) || []; },
      async one(id) { return tx('notes','readonly',s=>s.get(id)); },
      async save(note) { return withDb(db=>journal().write(db,'note',note.id,note,false)); },
      async delete(id) { return withDb(db=>journal().write(db,'note',id,null,true)); },
      async putAudio(id, blob) { await tx('audio','readwrite',s=>s.put({id,blob})); },
      async getAudio(id) { return (await tx('audio','readonly',s=>s.get(id)))?.blob || null; }
    },
    async googleDriveProbe(){
      if(!isNative())throw Error('Połączenie z Google Drive jest dostępne w APK.');
      return invoke('googleDriveProbe');
    },
    sync:{
      async bootstrap(){return withDb(db=>journal().bootstrap(db));},
      async status(){return withDb(db=>journal().inspect(db));},
      async record(id){return withDb(db=>journal().readRecord(db,id));},
      // Reserved for the future verified remote adapter, never called from user settings.
      async acknowledge(id,rev){return withDb(db=>journal().acknowledge(db,id,rev));}
    },
    semantic:{
      async all(){return (await tx('semantic_index','readonly',s=>s.getAll()))||[];},
      async save(entry){return tx('semantic_index','readwrite',s=>s.put(entry));},
      async delete(id){return tx('semantic_index','readwrite',s=>s.delete(id));},
      async clear(){return tx('semantic_index','readwrite',s=>s.clear());}
    },
    async offlineEmbeddingStatus(){
      if(!isNative())return {models:{}};
      return invoke('offlineEmbeddingStatus');
    },
    async downloadEmbeddingModel(model,onProgress){
      if(!isNative())throw Error('Lokalne embeddingi wymagają Android APK.');
      let listener=null;
      try{
        listener=await native()?.addListener?.('embeddingModelProgress',data=>onProgress?.(data));
        return await invoke('downloadEmbeddingModel',{model});
      }finally{await listener?.remove?.();}
    },
    async deleteEmbeddingModel(model){
      if(!isNative())throw Error('Lokalne embeddingi wymagają Android APK.');
      return invoke('deleteEmbeddingModel',{model});
    },
    async offlineEmbeddings({model,inputs,kind='document'}){
      if(!isNative())throw Error('Lokalne embeddingi wymagają Android APK.');
      const response=await invoke('offlineEmbeddings',{model,inputs,kind});
      return response.vectors;
    },
    async aiEmbeddings({baseUrl,model,inputs}){
      if(!isNative())throw Error('Embeddingi wymagają aplikacji na Androidzie.');
      const out=await invoke('aiEmbeddings',{baseUrl,model,inputs});
      return out.vectors||[];
    },
    tasks:{
      async all(){return (await tx('tasks','readonly',s=>s.getAll()))||[];},
      async save(task){return withDb(db=>journal().write(db,'task',task.id,task,false));},
      async delete(id){return withDb(db=>journal().write(db,'task',id,null,true));}
    },
    async exportBackup(data){
      if(!isNative())throw Error('Eksport ZIP jest dostępny w aplikacji Android.');
      return invoke('exportBackup',{data:JSON.stringify(data)});
    },
    async importBackup(){
      if(!isNative())throw Error('Import ZIP jest dostępny w aplikacji Android.');
      return invoke('importBackup');
    },
    async discardBackupImport(createdFiles){
      if(isNative())return invoke('discardBackupImport',{createdFiles});
    },
    async consumeQuickRecordLaunch(){
      return isNative() ? (await invoke('consumeQuickRecordLaunch')).requested===true : false;
    },
    async notificationPermission(){
      if(isNative())return invoke('notificationPermission');
      return {allowed:false};
    },
    async requestNotificationPermission(){
      if(isNative())return invoke('requestNotificationPermission');
      return {allowed:false};
    },
    async scheduleTaskReminder(task){
      if(!isNative())return {scheduled:false,reason:'web'};
      return invoke('scheduleTaskReminder',{
        id:task.id,noteId:task.noteId,title:task.title,dueAt:String(task.dueAt)
      });
    },
    async cancelTaskReminder(id){
      if(isNative())return invoke('cancelTaskReminder',{id});
      return null;
    },
    async pendingIncomingShares(){
      if(isNative())return (await invoke('pendingIncomingShares')).items||[];
      return [];
    },
    async acknowledgeIncomingShare(id){
      if(isNative())return invoke('acknowledgeIncomingShare',{id});
      return null;
    },
    async startRecording() {
      if (isNative()) return invoke('startRecording');
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error('Nagrywanie wymaga obsługiwanej przeglądarki i HTTPS.');
      audioStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      chunks = [];
      const types = ['audio/webm;codecs=opus','audio/mp4','audio/webm'];
      const mimeType = types.find(t=>MediaRecorder.isTypeSupported(t)) || '';
      mediaRecorder = new MediaRecorder(audioStream, mimeType ? {mimeType} : undefined);
      mediaRecorder.addEventListener('dataavailable',e=>{if(e.data.size)chunks.push(e.data);});
      mediaRecorder.start(1000);
      webStartedAt = Date.now(); pausedAt=0; pausedTotal=0;
      return {recording:true};
    },
    async pauseRecording() {
      if (isNative()) return invoke('pauseRecording');
      if (mediaRecorder?.state === 'recording') { mediaRecorder.pause(); pausedAt=Date.now(); }
    },
    async resumeRecording() {
      if (isNative()) return invoke('resumeRecording');
      if (mediaRecorder?.state === 'paused') { mediaRecorder.resume();pausedTotal += Date.now()-pausedAt;pausedAt=0; }
    },
    async recordingStatus() {
      if (isNative()) return invoke('recordingStatus');
      return {recording:!!mediaRecorder && mediaRecorder.state!=='inactive', paused:mediaRecorder?.state==='paused'};
    },
    async stopRecording(id) {
      if (isNative()) return invoke('stopRecording');
      if (!mediaRecorder || mediaRecorder.state==='inactive') throw Error('Brak aktywnego nagrania.');
      const m = mediaRecorder;
      const blob = await new Promise((resolve,reject)=>{
        m.addEventListener('stop',()=>resolve(new Blob(chunks,{type:m.mimeType||'audio/webm'})),{once:true});
        m.addEventListener('error',e=>reject(e.error||Error('Błąd nagrywania')),{once:true});
        m.stop();
      });
      audioStream?.getTracks().forEach(t=>t.stop()); audioStream=null;mediaRecorder=null;
      await platform.notes.putAudio(id,blob);
      return {audioRef:id,audioMime:blob.type,durationMs:Date.now()-webStartedAt-pausedTotal-(pausedAt?Date.now()-pausedAt:0),size:blob.size};
    },
    async audioUrl(note) {
      if (note.audioRef?.startsWith('file://')) return fileUrl(note.audioRef);
      if (note.audioRef?.startsWith('/')) return fileUrl(note.audioRef);
      const blob = await platform.notes.getAudio(note.audioRef||note.id);
      return blob ? URL.createObjectURL(blob) : '';
    },
    async deleteAudio(note) {
      if (!note?.audioRef) return;
      if (isNative()) return invoke('deleteAudio',{path:note.audioRef});
      return tx('audio','readwrite',s=>s.delete(note.audioRef));
    },
    async mergeRecordings(existing,additional){
      if(!isNative())throw Error('Łączenie nagrań WAV działa wyłącznie w aplikacji Android.');
      return invoke('mergeRecordings',{firstPath:existing.audioRef,secondPath:additional.audioRef});
    },
    async shareAudio(note) {
      if(isNative())return invoke('shareAudio',{path:note.audioRef});
      const blob=await platform.notes.getAudio(note.audioRef||note.id);if(!blob)throw Error('Brak nagrania.');
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='glos-'+note.id+'.'+(blob.type.includes('mp4')?'m4a':'webm');a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    },
    async shareText(text) {
      if(isNative())return invoke('shareText',{text});
      return null;
    },
    async importAudio(id, file) {
      if(isNative())return invoke('importAudio');
      if(!file || (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|opus|flac|aac)$/i.test(file.name)))throw Error('Wskaż plik dźwiękowy.');
      await platform.notes.putAudio(id,file);
      let durationMs=0;
      try{
        const url=URL.createObjectURL(file);
        durationMs=await new Promise(resolve=>{
          const audio=new Audio();
          const done=()=>{resolve(Number.isFinite(audio.duration)?audio.duration*1000:0);URL.revokeObjectURL(url)};
          audio.addEventListener('loadedmetadata',done,{once:true});
          audio.addEventListener('error',done,{once:true});
          audio.src=url;
          setTimeout(done,4000);
        });
      }catch{}
      return {audioRef:id,audioMime:file.type,durationMs,size:file.size,originalName:file.name};
    },
    async listRecordings() {
      if(isNative())return (await invoke('listRecordings')).recordings||[];
      return [];
    },
    async overlayStatus(){
      if(!isNative())return {enabled:false,granted:false};
      return invoke('overlayStatus');
    },
    async setOverlayEnabled(enabled){
      if(!isNative())throw Error('Panel pływający wymaga aplikacji Android.');
      return invoke('setOverlayEnabled',{enabled});
    },
    async importImages(files,max=10){
      if(isNative())return (await invoke('importImages',{max})).images||[];
      const imageTypes=['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'];
      if(!files?.length)return [];
      if(files.length>max)throw Error('Maksymalnie '+max+' obrazów naraz.');
      const result=[];
      try{
        for(const file of files){
          if(!imageTypes.includes(file.type))throw Error('Nieobsługiwany format: '+file.type);
          if(file.size>12*1024*1024)throw Error('Obraz przekracza limit 12 MB: '+file.name);
          if(!file.size)throw Error('Plik jest pusty: '+file.name);
          const id='img-'+(crypto.randomUUID?.()||Date.now()+'-'+Math.random());
          await tx('images','readwrite',s=>s.put({id,blob:file}));
          result.push({id,name:file.name.slice(0,80),mime:file.type,size:file.size});
        }
        return result;
      }catch(err){
        for(const image of result)await tx('images','readwrite',s=>s.delete(image.id));
        throw err;
      }
    },
    async imageUrl(image){
      if(isNative())return fileUrl(image.path);
      const entry=await tx('images','readonly',s=>s.get(image.id));
      return entry?.blob?URL.createObjectURL(entry.blob):'';
    },
    async recognizeImageText(image){
      if(!isNative())throw Error('OCR offline działa w aplikacji Android.');
      return invoke('recognizeImageText',{path:image.path});
    },
    async deleteImage(image){
      if(isNative())return invoke('deleteImage',{path:image.path});
      return tx('images','readwrite',s=>s.delete(image.id));
    },
    async shareImage(image){
      if(isNative())return invoke('shareImage',{path:image.path,mime:image.mime});
      const url=await platform.imageUrl(image);
      if(!url)throw Error('Nie odnaleziono obrazu.');
      const a=document.createElement('a');a.href=url;a.download=image.name||'obraz.jpg';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
    },
    async modelStatus() {
      if (isNative()) return invoke('modelStatus');
      return {installed:false,native:false,models:{parakeet:false,'whisper-tiny':false,'whisper-base':false,'whisper-small':false}};
    },
    async downloadModel(model='parakeet',onProgress) {
      if (!isNative()) throw Error('Lokalny model STT wymaga aplikacji Android APK.');
      let handler = null;
      try {
        const plugin=native();
        if (plugin?.addListener) handler=await plugin.addListener('modelProgress',v=>onProgress?.(v));
        return await invoke('downloadModel',{model});
      } finally { await handler?.remove?.(); }
    },
    async deleteModel(model) {
      if (!isNative()) throw Error('Zarządzanie modelami jest dostępne w APK.');
      return invoke('deleteModel',{model});
    },
    async transcribe(note,model='parakeet',onProgress) {
      if (!isNative()) throw Error('Transkrypcja offline wymaga aplikacji Android APK.');
      let handler=null;
      try {
        const plugin=native();
        if (plugin?.addListener) handler=await plugin.addListener('transcribeProgress',v=>onProgress?.(v));
        return await invoke('transcribe',{path:note.audioRef,model});
      } finally { await handler?.remove?.(); }
    },
    async saveAiKey(key) {
      if(isNative()) return invoke('saveAiKey',{value:key});
      sessionStorage.setItem('glos_ai_key',key);return {saved:true};
    },
    async clearAiKey() {
      if(isNative()) return invoke('clearAiKey');
      sessionStorage.removeItem('glos_ai_key');return {saved:true};
    },
    async hasAiKey() {
      if(isNative()) return (await invoke('hasAiKey')).hasKey;
      return !!sessionStorage.getItem('glos_ai_key');
    },
    async aiChat({baseUrl,model,messages}) {
      if(isNative()) return invoke('aiChat',{baseUrl,model,messages});
      const key=sessionStorage.getItem('glos_ai_key');
      if(!key) throw Error('Dodaj klucz API w ustawieniach.');
      if(!/^https:\/\//i.test(baseUrl) && !/^http:\/\/localhost(?::\d+)?\/v1\/?$/.test(baseUrl)) throw Error('API musi używać HTTPS.');
      const response=await fetch(baseUrl.replace(/\/+$/,'')+'/chat/completions',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
        body:JSON.stringify({model,messages,temperature:.2})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw Error(data.error?.message||`HTTP ${response.status}`);
      return {text:data.choices?.[0]?.message?.content||''};
    }
  };
  window.GlosPlatform = platform;
})();
