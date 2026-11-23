/* GŁOS Notes · durable local change journal for future multi-device sync.
   Every note/task mutation and its pending outbox entry share one IndexedDB
   transaction. No provider connection or network traffic occurs here. */
(()=>{
  'use strict';
  const version=1;
  const stores={notes:'notes',tasks:'tasks',revisions:'sync_revisions',outbox:'sync_outbox',meta:'sync_meta'};
  const stamp=()=>Date.now();
  const uuid=()=>{
    const crypto=globalThis.crypto;
    if(crypto?.randomUUID)return crypto.randomUUID();
    if(!crypto?.getRandomValues)throw Error('Synchronizacja wymaga bezpiecznego generatora losowego.');
    const b=new Uint8Array(16);crypto.getRandomValues(b);
    b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    return [...b].map((n,i)=>n.toString(16).padStart(2,'0')+
      ([3,5,7,9].includes(i)?'-':'')).join('').replace(/-$/,'');
  };
  const typeStore=type=>{
    if(type==='note')return stores.notes;
    if(type==='task')return stores.tasks;
    throw Error('Nieobsługiwany typ synchronizowanego wpisu.');
  };
  const recordId=(type,id)=>{
    if(typeof id!=='string'||!/^[\w.:-]{1,140}$/.test(id)||id.includes('..'))
      throw Error('Nieprawidłowy identyfikator synchronizacji.');
    return type+':'+id;
  };
  const transactionPromise=(tx,setup)=>new Promise((resolve,reject)=>{
    let result;
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error||Error('Błąd transakcji synchronizacji.'));
    tx.onabort=()=>reject(tx.error||Error('Zapis synchronizacji został przerwany.'));
    try{setup(value=>{result=value;});}
    catch(err){try{tx.abort()}catch{}reject(err)}
  });
  function write(db,type,id,value,deleted=false){
    const entityStore=typeStore(type),key=recordId(type,id);
    if(!deleted && (!value||value.id!==id))throw Error('Wpis bez prawidłowego identyfikatora.');
    const names=[entityStore,stores.revisions,stores.outbox,stores.meta];
    if(type==='note'&&deleted)names.push('audio');
    const tx=db.transaction(names,'readwrite');
    return transactionPromise(tx,finish=>{
      const metareq=tx.objectStore(stores.meta).get('device');
      const revreq=tx.objectStore(stores.revisions).get(key);
      let metaDone=false,revDone=false,meta,previous;
      const fail=()=>{try{tx.abort()}catch{}};
      const whenReady=()=>{
        if(!metaDone||!revDone)return;
        try{
        const device=meta?.value||'dev-'+uuid();
        if(!meta)tx.objectStore(stores.meta).put({id:'device',value:device,createdAt:stamp()});
        const revision='rev-'+uuid();
        const record={
          id:key,type,entityId:id,rev:revision,parent:previous?.rev||null,
          syncedRev:previous?.syncedRev||null,
          deleted:!!deleted,device,changedAt:stamp()
        };
        const op={id:key,rev:revision,type,entityId:id,
          action:deleted?'delete':'upsert',createdAt:stamp(),status:'pending'};
        tx.objectStore(entityStore)[deleted?'delete':'put'](deleted?id:value);
        if(type==='note'&&deleted)tx.objectStore('audio').delete(id);
        tx.objectStore(stores.revisions).put(record);
        tx.objectStore(stores.outbox).put(op);
        finish(record);
        }catch(err){try{tx.abort()}catch{}}
      };
      metareq.onsuccess=()=>{meta=metareq.result;metaDone=true;whenReady()};
      revreq.onsuccess=()=>{previous=revreq.result;revDone=true;whenReady()};
      metareq.onerror=fail;revreq.onerror=fail;
    });
  }
  // Existing note/task rows are indexed with one durable, resumable pass. All
  // created revision rows are written before IndexedDB transaction commits.
  function bootstrap(db){
    const tx=db.transaction([stores.notes,stores.tasks,stores.meta,stores.revisions,stores.outbox],'readwrite');
    return transactionPromise(tx,finish=>{
      const meta=tx.objectStore(stores.meta).get('device');
      meta.onsuccess=()=>{
        let device=meta.result?.value;
        if(!device){
          device='dev-'+uuid();
          tx.objectStore(stores.meta).put({id:'device',value:device,createdAt:stamp()});
        }
        const result={device,count:0};
        for(const type of ['note','task']){
          const cursor=tx.objectStore(typeStore(type)).openCursor();
          cursor.onsuccess=()=>{
            const row=cursor.result;
            if(!row)return;
            const id=row.value?.id;
            if(typeof id!=='string'||!id.trim()){
              row.continue();return;
            }
            const key=recordId(type,id);
            const check=tx.objectStore(stores.revisions).get(key);
            check.onsuccess=()=>{
              if(!check.result){
                const rev='rev-'+uuid();
                const value={
                  id:key,type,entityId:id,rev,parent:null,syncedRev:null,
                  deleted:false,device,changedAt:stamp()
                };
                tx.objectStore(stores.revisions).put(value);
                tx.objectStore(stores.outbox).put({
                  id:key,rev,type,entityId:id,action:'upsert',createdAt:stamp(),status:'pending'
                });
                result.count++;
              }
              row.continue();
            };
          };
        }
        finish(result);
      };
    });
  }
  function inspect(db){
    const tx=db.transaction([stores.meta,stores.revisions,stores.outbox],'readonly');
    return transactionPromise(tx,finish=>{
      const meta=tx.objectStore(stores.meta).get('device');
      const rev=tx.objectStore(stores.revisions).getAll();
      const queue=tx.objectStore(stores.outbox).getAll();
      let ready=0;
      const complete=()=>{
        if(++ready!==3)return;
        const rows=rev.result||[],pending=queue.result||[];
        finish({deviceId:meta.result?.value||null,version,
          notes:rows.filter(x=>x.type==='note'&&!x.deleted).length,
          tasks:rows.filter(x=>x.type==='task'&&!x.deleted).length,
          tombstones:rows.filter(x=>x.deleted).length,
          pending:pending.length,
          pendingNotes:pending.filter(x=>x.type==='note').length,
          pendingTasks:pending.filter(x=>x.type==='task').length,
          lastEditAt:Math.max(0,...rows.map(x=>x.changedAt||0)),
          outbox:pending.slice(-500).map(x=>({...x}))
        });
      };
      meta.onsuccess=complete;rev.onsuccess=complete;queue.onsuccess=complete;
    });
  }
  // An operation is acknowledged only if its revision is STILL the current
  // outbox item. Concurrent edits must never be accidentally marked synced.
  function acknowledge(db,id,rev){
    if(typeof id!=='string'||typeof rev!=='string')throw Error('Błędny identyfikator potwierdzenia.');
    const tx=db.transaction([stores.revisions,stores.outbox],'readwrite');
    return transactionPromise(tx,finish=>{
      const current=tx.objectStore(stores.outbox).get(id);
      current.onsuccess=()=>{
        if(!current.result||current.result.rev!==rev){finish(false);return}
        const record=tx.objectStore(stores.revisions).get(id);
        record.onsuccess=()=>{
          if(record.result?.rev!==rev){finish(false);return}
          tx.objectStore(stores.outbox).delete(id);
          tx.objectStore(stores.revisions).put({...record.result,syncedRev:rev});
          finish(true);
        };
      };
    });
  }
  function readRecord(db,id){
    const tx=db.transaction(stores.revisions,'readonly');
    return transactionPromise(tx,finish=>{
      tx.objectStore(stores.revisions).get(id).onsuccess=e=>finish(e.target.result||null);
    });
  }
  window.GlosSyncJournal={version,write,bootstrap,inspect,acknowledge,readRecord,recordId};
})();