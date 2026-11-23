/* GŁOS Notes PWA ZIP backup. All media stays client-side.
   A backup is NOT encrypted: save ZIP in a trusted private location. */
(()=>{
  'use strict';
  const FORMAT='glos-pwa-backup';
  const MAX_ARCHIVE=300*1024*1024;
  const MAX_ASSET=140*1024*1024;
  const MAX_ASSETS=1200;
  const db=()=>new Promise((resolve,reject)=>{
    const req=indexedDB.open('glos_notes_v2',6);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||Error('Błąd odczytu bazy notatek.'));
    req.onupgradeneeded=()=>{throw Error('Najpierw uruchom aplikację GŁOS Notes.');};
  });
  const transact=async(store,mode,fn)=>{
    const database=await db();
    try{
      return await new Promise((resolve,reject)=>{
        const transaction=database.transaction(store,mode);
        let value;
        transaction.oncomplete=()=>resolve(value);
        transaction.onerror=()=>reject(transaction.error||Error('Błąd zapisu załącznika.'));
        try{
          const req=fn(transaction.objectStore(store));
          req.onsuccess=()=>{value=req.result};
        }catch(err){transaction.abort();reject(err);}
      });
    }finally{database.close();}
  };
  const get=(kind,id)=>transact(kind,'readonly',s=>s.get(id));
  const put=(kind,id,blob)=>transact(kind,'readwrite',s=>s.put({id,blob}));
  const remove=(kind,id)=>transact(kind,'readwrite',s=>s.delete(id));
  const idOk=id=>typeof id==='string'&&id.length>0&&id.length<=200;
  const validMedia=(kind,ref)=>{
    if(!idOk(ref))throw Error('Nieprawidłowy identyfikator '+kind+' w kopii.');
  };
  const idsFromNotes=(notes,kind)=>{
    const list=new Set();
    for(const note of notes){
      if(kind==='audio'){
        if(note.audioRef)list.add(note.audioRef);
        for(const part of (Array.isArray(note.extraRecordings)?note.extraRecordings:[])){
          if(part.audioRef)list.add(part.audioRef);
        }
      }else{
        for(const img of (Array.isArray(note.images)?note.images:[])){
          if(img.id)list.add(img.id);
        }
      }
    }
    return [...list];
  };
  const download=(blob,name)=>{
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  };
  async function exportArchive(data){
    if(!window.JSZip)throw Error('Biblioteka ZIP nie została załadowana.');
    if(!data||!Array.isArray(data.notes)||!Array.isArray(data.tasks))
      throw Error('Nieprawidłowy zestaw danych do kopii.');
    const zip=new JSZip();
    const list={audio:[],images:[]};
    let total=0;
    for(const kind of ['audio','images']){
      const ids=idsFromNotes(data.notes,kind);
      if(ids.length>MAX_ASSETS)throw Error('Za dużo plików do wykonania kopii.');
      for(let i=0;i<ids.length;i++){
        const id=ids[i];validMedia(kind,id);
        const entry=await get(kind,id);
        if(!(entry?.blob instanceof Blob)||!entry.blob.size)
          throw Error('Brak pliku '+kind+' dla wpisu '+id+'. Nie utworzono niepełnej kopii.');
        if(entry.blob.size>MAX_ASSET)throw Error('Zbyt duży plik: '+id);
        total+=entry.blob.size;
        if(total>MAX_ARCHIVE)throw Error('Kopia przekracza 300 MB. Wyeksportuj część notatek osobno.');
        const file='media/'+kind+'/'+i+'.bin';
        list[kind].push({id,file,size:entry.blob.size,mime:entry.blob.type||'application/octet-stream'});
        zip.file(file,entry.blob,{compression:'STORE'});
      }
    }
    zip.file('backup.json',JSON.stringify({format:FORMAT,version:1,createdAt:Date.now(),data,media:list}));
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:4},streamFiles:true});
    if(blob.size>MAX_ARCHIVE)throw Error('Kopia przekroczyła limit bezpieczeństwa 300 MB.');
    download(blob,'GLOS-Notes-'+new Date().toISOString().slice(0,10)+'.zip');
    return {stats:{notes:data.notes.length,tasks:data.tasks.length,audio:list.audio.length,images:list.images.length}};
  }
  async function rollback(created){
    for(const item of created||[]){
      if((item?.kind==='audio'||item?.kind==='images')&&idOk(item.id))
        await remove(item.kind,item.id).catch(()=>{});
    }
  }
  async function importArchive(file){
    if(!window.JSZip)throw Error('Biblioteka ZIP nie została załadowana.');
    if(!(file instanceof Blob)||!file.size||file.size>MAX_ARCHIVE)
      throw Error('Nieprawidłowy plik ZIP lub przekroczony limit 300 MB.');
    const zip=await JSZip.loadAsync(file,{checkCRC32:true});
    const entry=zip.file('backup.json');
    if(!entry||entry._data?.uncompressedSize>8*1024*1024)
      throw Error('To nie jest kopia PWA GŁOS Notes.');
    const raw=await entry.async('string');
    if(raw.length>8*1024*1024)throw Error('Zbyt duży manifest kopii.');
    let manifest;
    try{manifest=JSON.parse(raw);}catch{throw Error('Nieprawidłowy format kopii ZIP.');}
    if(manifest?.format!==FORMAT||manifest.version!==1||
      !Array.isArray(manifest.data?.notes)||!Array.isArray(manifest.data?.tasks))
      throw Error('Nieobsługiwana kopia. Importuj ZIP wyeksportowany przez PWA GŁOS Notes.');
    if(manifest.data.notes.length>5000||manifest.data.tasks.length>5000)
      throw Error('Zbyt wiele notatek w kopii.');
    const created=[],mapping=Object.create(null);
    const assets=manifest.media||{};
    const audioIds=idsFromNotes(manifest.data.notes,'audio');
    const imageIds=idsFromNotes(manifest.data.notes,'images');
    for(const [kind,expected] of [['audio',audioIds],['images',imageIds]]){
      const items=assets[kind];
      if(!Array.isArray(items)||items.length>MAX_ASSETS)
        throw Error('Nieprawidłowa lista plików '+kind+'.');
      const provided=new Set(items.map(x=>x?.id));
      if(provided.size!==items.length||expected.some(id=>!provided.has(id)))
        throw Error('Kopia nie zawiera wszystkich plików '+kind+'.');
    }
    let total=0;
    try{
      for(const kind of ['audio','images']){
        const entries=assets[kind];
        for(let i=0;i<entries.length;i++){
          const record=entries[i];
          validMedia(kind,record.id);
          const expected='media/'+kind+'/'+i+'.bin';
          if(record.file!==expected||!Number.isSafeInteger(record.size)||
            record.size<1||record.size>MAX_ASSET)
            throw Error('Nieprawidłowy opis pliku ZIP.');
          total+=record.size;
          if(total>MAX_ARCHIVE)throw Error('Kopia przekracza limit bezpieczeństwa.');
          const item=zip.file(expected);
          if(!item||item._data?.uncompressedSize!==record.size)
            throw Error('Niepełne lub nieprawidłowe dane: '+expected);
          const blob=await item.async('blob');
          if(blob.size!==record.size)throw Error('Plik ZIP nie przeszedł kontroli wielkości.');
          const newId='pwa-'+crypto.randomUUID();
          await put(kind,newId,new Blob([blob],{type:String(record.mime||'application/octet-stream').slice(0,100)}));
          created.push({kind,id:newId});
          mapping[record.id]=newId;
        }
      }
      return {data:manifest.data,mapping,createdFiles:created};
    }catch(err){
      await rollback(created);
      throw err;
    }
  }
  window.GlosPwaBackup={exportArchive,importArchive,rollback};
})();
