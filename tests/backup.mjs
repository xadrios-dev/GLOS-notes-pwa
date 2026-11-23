import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import JSZip from 'jszip';
import {indexedDB} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';

const req=indexedDB.open('glos_notes_v2',6);
await new Promise((resolve,reject)=>{
  req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('audio',{keyPath:'id'});db.createObjectStore('images',{keyPath:'id'});};
  req.onsuccess=resolve;req.onerror=()=>reject(req.error);
});
req.result.close();
const tx=(kind,mode,fn)=>new Promise((resolve,reject)=>{
  const d=indexedDB.open('glos_notes_v2',6);
  d.onsuccess=()=>{
    const db=d.result,transaction=db.transaction(kind,mode),r=fn(transaction.objectStore(kind));
    transaction.oncomplete=()=>{db.close();resolve(r.result);};
    transaction.onerror=()=>{db.close();reject(transaction.error);};
  };
  d.onerror=()=>reject(d.error);
});
await tx('audio','readwrite',s=>s.put({id:'audio-old',blob:new Blob(['testing-audio'],{type:'audio/mp4'})}));
await tx('images','readwrite',s=>s.put({id:'image-old',blob:new Blob(['testing-image'],{type:'image/png'})}));
let downloaded=null;
const context={
  window:{JSZip},JSZip,
  indexedDB,Blob,crypto:webcrypto,
  URL:{createObjectURL:blob=>{downloaded=blob;return 'blob:offline-zip'},revokeObjectURL(){}},
  document:{body:{appendChild(){}},createElement:()=>({click(){},remove(){}})},
  setTimeout(){}
};
vm.runInNewContext(fs.readFileSync('www/pwa-backup.js','utf8'),context,{filename:'pwa-backup.js'});
const api=context.window.GlosPwaBackup;
const exported=await api.exportArchive({
  notes:[{id:'note-1',title:'Próba',audioRef:'audio-old',audioMime:'audio/mp4',images:[{id:'image-old',name:'obraz.png'}]}],
  tasks:[{id:'task-1',title:'Test'}],tags:[],settings:{},libraryChat:[]
});
assert.equal(exported.stats.notes,1);
assert.equal(exported.stats.audio,1);
assert.equal(exported.stats.images,1);
assert(downloaded instanceof Blob);
const archive=await JSZip.loadAsync(await downloaded.arrayBuffer());
const meta=JSON.parse(await archive.file('backup.json').async('string'));
assert.equal(meta.format,'glos-pwa-backup');
assert.equal(meta.media.audio.length,1);
assert.equal(meta.media.images.length,1);
const restored=await api.importArchive(downloaded);
assert.equal(restored.data.notes[0].title,'Próba');
assert.notEqual(restored.mapping['audio-old'],'audio-old');
assert.notEqual(restored.mapping['image-old'],'image-old');
const importedAudio=await tx('audio','readonly',s=>s.get(restored.mapping['audio-old']));
const importedImage=await tx('images','readonly',s=>s.get(restored.mapping['image-old']));
assert(importedAudio?.blob?.size>0 && importedImage?.blob?.size>0);
await api.rollback(restored.createdFiles);
assert.equal(await tx('audio','readonly',s=>s.get(restored.mapping['audio-old'])),undefined);
console.log('✓ PWA ZIP backup roundtrip and rollback: PASS');
