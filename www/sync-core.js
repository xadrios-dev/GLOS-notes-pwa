/* GŁOS Notes · Sync protocol foundation v1.
   Provider-neutral, offline-first planner and encrypted metadata envelopes.
   This module DOES NOT connect to a cloud account or transfer files. */
(()=>{
  'use strict';
  const LIMITS={notes:50000,metaBytes:2_000_000,passwordChars:1024};
  const validId=x=>typeof x==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,139}$/.test(x) && !x.includes('..');
  const validRev=x=>typeof x==='string'&&/^[A-Za-z0-9_:-]{8,140}$/.test(x);
  const textEncoder=new TextEncoder();
  const textDecoder=new TextDecoder('utf-8',{fatal:true});
  const subtle=()=>globalThis.crypto?.subtle || (()=>{throw Error('Wymagana bezpieczna implementacja WebCrypto.');})();
  const random=size=>{
    const value=new Uint8Array(size);
    globalThis.crypto?.getRandomValues?.(value);
    if(value.every(x=>x===0))throw Error('Bezpieczny generator losowy nie jest dostępny.');
    return value;
  };
  const toBase64=bytes=>{
    let out='';
    for(let i=0;i<bytes.length;i+=16384)
      out+=String.fromCharCode(...bytes.slice(i,i+16384));
    return btoa(out);
  };
  const fromBase64=value=>{
    if(typeof value!=='string'||value.length>LIMITS.metaBytes*3||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))
      throw Error('Nieprawidłowy zapis zaszyfrowanych danych.');
    const source=atob(value);
    return Uint8Array.from(source,c=>c.charCodeAt(0));
  };
  async function deriveKey(passphrase,salt){
    if(typeof passphrase!=='string'||passphrase.length<12||passphrase.length>LIMITS.passwordChars)
      throw Error('Hasło synchronizacji musi mieć co najmniej 12 znaków.');
    if(!(salt instanceof Uint8Array)||salt.length!==16)throw Error('Nieprawidłowa sól klucza.');
    const source=await subtle().importKey('raw',textEncoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
    return subtle().deriveKey(
      {name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},
      source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  // Non-secret metadata is in AAD, so it is authenticated along with ciphertext.
  async function encryptJson(content,passphrase,context='GLOS-sync-v1'){
    if(typeof context!=='string'||context.length>200||!context)throw Error('Nieprawidłowy kontekst danych.');
    const plain=textEncoder.encode(JSON.stringify(content));
    if(plain.length>LIMITS.metaBytes)throw Error('Metadane synchronizacji są za duże.');
    const salt=random(16),nonce=random(12),key=await deriveKey(passphrase,salt);
    const cipher=await subtle().encrypt(
      {name:'AES-GCM',iv:nonce,additionalData:textEncoder.encode(context)},
      key,plain);
    return{version:1,algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:310000,
      salt:toBase64(salt),nonce:toBase64(nonce),context,ciphertext:toBase64(new Uint8Array(cipher))};
  }
  async function decryptJson(envelope,passphrase,context='GLOS-sync-v1'){
    if(!envelope||envelope.version!==1||envelope.algorithm!=='AES-256-GCM'||
        envelope.kdf!=='PBKDF2-SHA256'||envelope.iterations!==310000||
        envelope.context!==context)
      throw Error('Nieobsługiwany lub nieprawidłowy format szyfrowania.');
    const salt=fromBase64(envelope.salt),nonce=fromBase64(envelope.nonce),
      encrypted=fromBase64(envelope.ciphertext);
    if(salt.length!==16||nonce.length!==12||encrypted.length<16||
        encrypted.length>LIMITS.metaBytes+16)throw Error('Nieprawidłowy rozmiar zaszyfrowanych danych.');
    const key=await deriveKey(passphrase,salt);
    let plain;
    try{
      plain=await subtle().decrypt(
        {name:'AES-GCM',iv:nonce,additionalData:textEncoder.encode(context)},
        key,encrypted);
    }catch{
      throw Error('Nie można odszyfrować danych. Sprawdź hasło lub integralność kopii.');
    }
    return JSON.parse(textDecoder.decode(plain));
  }
  function assertRecord(x){
    if(!x||!validId(x.id)||!validRev(x.rev)||
      (x.parent!==null&&x.parent!==undefined&&!validRev(x.parent))||
      typeof x.deleted!=='boolean' || !validId(x.device))
      throw Error('Nieprawidłowy rekord synchronizacji.');
    return {id:x.id,rev:x.rev,parent:x.parent||null,deleted:x.deleted,device:x.device};
  }
  function normalizeList(rows){
    if(!Array.isArray(rows)||rows.length>LIMITS.notes)throw Error('Nieprawidłowa liczba elementów synchronizacji.');
    const seen=new Set(),map=new Map();
    for(const row of rows){
      const entry=assertRecord(row);
      if(seen.has(entry.id))throw Error('Zduplikowany identyfikator notatki.');
      seen.add(entry.id);map.set(entry.id,entry);
    }
    return map;
  }
  /**
   * Last agreed versions are stored per device:
   * { noteId: {localRev,remoteRev} }. Never compare timestamps for authority.
   * Conflicts and deletions require explicit review and are NOT auto-applied.
   */
  function plan(local,remote,agreed={}){
    const L=normalizeList(local),R=normalizeList(remote);
    const groups={upload:[],download:[],conflicts:[],reviewDeletion:[],unchanged:[]};
    for(const id of new Set([...L.keys(),...R.keys()])){
      const left=L.get(id),right=R.get(id),baseline=agreed?.[id];
      if(!left&&right){
        (right.deleted?groups.reviewDeletion:groups.download).push(id);continue;
      }
      if(left&&!right){
        (left.deleted?groups.reviewDeletion:groups.upload).push(id);continue;
      }
      if(left.rev===right.rev && left.deleted===right.deleted){
        groups.unchanged.push(id);continue;
      }
      if(left.deleted||right.deleted){
        groups.reviewDeletion.push(id);continue;
      }
      // A remote revision explicitly based on this local revision is safe to fast-forward.
      if(right.parent===left.rev){groups.download.push(id);continue;}
      if(left.parent===right.rev){groups.upload.push(id);continue;}
      const lchanged=!baseline||baseline.localRev!==left.rev;
      const rchanged=!baseline||baseline.remoteRev!==right.rev;
      if(lchanged&&rchanged)groups.conflicts.push(id);
      else if(lchanged)groups.upload.push(id);
      else if(rchanged)groups.download.push(id);
      else groups.conflicts.push(id);
    }
    return {...groups,hasUnresolved:!!(groups.conflicts.length||groups.reviewDeletion.length)};
  }
  function safeMediaKey(value){
    if(typeof value!=='string'||!/^media\/(audio|image)\/[a-f0-9]{64}\.(wav|jpg|jpeg|png|webp|gif|heic|heif)$/.test(value))
      throw Error('Nieprawidłowy klucz załącznika. Przerwano przed zapisaniem pliku.');
    return value;
  }
  function validateManifest(data){
    if(!data||data.schema!==1||!validId(data.libraryId)||!validId(data.deviceId)||
      !Array.isArray(data.records))throw Error('Nieprawidłowy manifest biblioteki.');
    const records=normalizeList(data.records);
    const files=data.files||[];
    if(!Array.isArray(files)||files.length>LIMITS.notes)throw Error('Nieprawidłowa lista załączników.');
    for(const file of files){
      safeMediaKey(file?.key);
      if(!Number.isSafeInteger(file.size)||file.size<0||file.size>500_000_000)
        throw Error('Nieprawidłowy rozmiar załącznika.');
    }
    return{libraryId:data.libraryId,deviceId:data.deviceId,recordCount:records.size,fileCount:files.length};
  }
  const conflictCopy=(note,deviceId,newId)=>{
    if(!validId(newId))throw Error('Nieprawidłowy identyfikator kopii konfliktowej.');
    const copy=JSON.parse(JSON.stringify(note));
    copy.id=newId;
    copy.title=String(copy.title||'Bez tytułu').slice(0,95)+' (konflikt '+String(deviceId).slice(0,12)+')';
    delete copy._sync;
    copy.conflictSourceId=note.id;
    return copy;
  };
  window.GlosSync={plan,encryptJson,decryptJson,validateManifest,safeMediaKey,conflictCopy,assertRecord};
})();