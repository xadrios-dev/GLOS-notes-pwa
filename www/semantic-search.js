/* Provider-specific local/API vectors with content revision checks and hybrid ranking. */
(()=>{
  'use strict';
  const hash=text=>{
    let v=2166136261;
    for(const c of String(text)){
      v^=c.charCodeAt(0);v=Math.imul(v,16777619);
    }
    return (v>>>0).toString(36);
  };
  function chunks(text,limit=1050,max=12){
    const original=String(text||'').trim();
    const result=[];let at=0;
    while(at<original.length && result.length<max){
      let end=Math.min(original.length,at+limit);
      if(end<original.length){
        const cut=original.lastIndexOf(' ',end);
        if(cut>at+limit*.7)end=cut;
      }
      const text=original.slice(at,end).trim();
      if(text)result.push(text);
      if(end>=original.length)break;
      at=end;
    }
    return result;
  }
  function documents(notes,tags=[]){
    const result=[];
    const sorted=[...notes].filter(n=>n&&typeof n.id==='string')
      .sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
    const tagNames=n=>(n.tags||[]).map(id=>tags.find(t=>t.id===id)?.name).filter(Boolean).join(', ');
    const add=(n,kind,key,content)=>{
      const text=String(content||'').trim();
      if(!text)return;
      const prefix=(n.title||'Bez tytułu')+' | '+kind+
        (tagNames(n)?' | Tagi: '+tagNames(n):'');
      const body=(prefix+'\n'+text).slice(0,1600);
      const id=n.id+':'+key;
      result.push({id,noteId:n.id,title:n.title||'Bez tytułu',kind,body,hash:hash(body)});
    };
    for(const n of sorted){
      if(result.length>=1200)break;
      if(n.summary?.trim())chunks(n.summary,1050,3).forEach((part,i)=>add(n,'Podsumowanie','summary:'+i,part));
      chunks(n.transcript,1050,12).forEach((part,i)=>add(n,'Transkrypcja','transcript:'+i,part));
      for(const image of (n.images||[]).slice(0,20)){
        if(!image?.ocrText?.trim())continue;
        chunks(image.ocrText,1050,3).forEach((part,i)=>add(n,'OCR · '+(image.name||'obraz'),'ocr:'+image.id+':'+i,part));
      }
      if(!n.transcript?.trim()&&!n.summary?.trim()&&!n.images?.some(x=>x.ocrText?.trim()))
        add(n,'Tytuł','title',n.title||'Bez tytułu');
    }
    return result.slice(0,1200);
  }
  const normalizeVector=vec=>{
    if(!Array.isArray(vec)||vec.length<64||vec.length>4096)return null;
    let sum=0;const output=[];
    for(const item of vec){
      const n=Number(item);
      if(!Number.isFinite(n))return null;
      sum+=n*n;output.push(n);
    }
    if(sum<=0)return null;
    const scale=1/Math.sqrt(sum);
    return output.map(v=>v*scale);
  };
  function rank(records,queryVector,notes,tags,model,limit=8){
    const question=normalizeVector(queryVector);if(!question)return {matches:0,sources:[],context:'',blocks:[]};
    const current=new Map(documents(notes,tags).map(doc=>[doc.id,doc]));
    const scored=[];
    for(const row of records){
      const doc=current.get(row.docId||row.id);
      if(!doc||row.hash!==doc.hash||row.model!==model||!Array.isArray(row.vector))continue;
      if(row.vector.length!==question.length)continue;
      let dot=0,mag=0;
      for(let i=0;i<question.length;i++){
        dot+=question[i]*row.vector[i];mag+=row.vector[i]*row.vector[i];
      }
      const score=dot/Math.sqrt(mag||1);
      if(Number.isFinite(score)&&score>=.12)scored.push({...doc,score});
    }
    scored.sort((a,b)=>b.score-a.score);
    const chosen=[],byNote=new Map();
    for(const row of scored){
      if(chosen.length>=limit)break;
      const count=byNote.get(row.noteId)||0;
      if(count>=2)continue;
      chosen.push(row);byNote.set(row.noteId,count+1);
    }
    const sources=[];const keys=new Map();
    chosen.forEach(x=>{
      if(!keys.has(x.noteId)){
        const key='N'+(keys.size+1);
        keys.set(x.noteId,key);
        sources.push({key,id:x.noteId,title:x.title});
      }
    });
    const blocks=chosen.map(x=>({noteId:x.noteId,title:x.title,kind:x.kind,body:x.body,score:x.score}));
    const context=chosen.map(x=>'['+keys.get(x.noteId)+'] '+x.title+' · '+x.kind+'\n'+x.body)
      .join('\n\n===== KOLEJNE ŹRÓDŁO =====\n\n');
    return{sources,context,blocks,matches:chosen.length};
  }
  function combine(lexical,semantic){
    if(!semantic?.matches)return lexical;
    if(!lexical?.matches)return semantic;
    const sources=[],used=new Map(),contexts=[],seen=new Set();
    const addSource=(src)=>{
      if(used.has(src.id))return used.get(src.id);
      if(sources.length>=9)return null;
      const key='N'+(sources.length+1);
      used.set(src.id,key);sources.push({key,id:src.id,title:src.title});
      return key;
    };
    const add=(result)=>{
      const local=new Map((result.sources||[]).map(s=>[s.key,s]));
      const parts=String(result.context||'').split('\n\n===== KOLEJNE ŹRÓDŁO =====\n\n');
      for(const part of parts){
        const found=part.match(/^\[(N\d+)\]/);
        const src=found&&local.get(found[1]);
        if(!src||contexts.length>=11)continue;
        const key=addSource(src);
        if(!key)continue;
        const updated=part.replace(/^\[N\d+\]/,'['+key+']').slice(0,2200);
        const sig=src.id+':'+hash(updated);
        if(seen.has(sig))continue;
        if(contexts.reduce((sum,x)=>sum+x.length,0)+updated.length>12000)break;
        contexts.push(updated);seen.add(sig);
      }
    };
    add(semantic);add(lexical);
    return{sources,context:contexts.join('\n\n===== KOLEJNE ŹRÓDŁO =====\n\n'),
      matches:contexts.length};
  }
  window.GlosSemantic={documents,hash,normalizeVector,rank,combine};
})();