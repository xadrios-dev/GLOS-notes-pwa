/* GŁOS library retrieval: local, bounded, evidence-based search. */
(()=>{
  'use strict';
  const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const stops=new Set('czy jak jakie jaki jaka jest sa bylo byly bedzie bylyby ten tego tym oraz albo oraz zeby gdy sie do na od po we dla przy bez tez co ze za ten tam mnie mnie moje moje i a o z w u to oraz czyli gdzie kiedy ktory ktora ktore jakich ich nasz nasza'.split(' '));
  const stem=w=>{
    const x=normalize(w);
    if(x.length>6)return x.replace(/(owego|owej|owych|owymi|aniem|eniem|aniem|acja|acje|acji|enie|aniu|osci|ach|ami|ego|emu|owa|owe|owy|ami|cja|cji|cie|nia|owa|anie|eni|ie|ow|ym|ej|ą|ę)$/u,'');
    return x;
  };
  const tokens=text=>(normalize(text).match(/[\p{L}\p{N}]{3,}/gu)||[])
      .filter(x=>!stops.has(x)).map(stem).filter(x=>x.length>=3);
  function chunkText(source,limit=1200){
    const text=String(source||'').trim();if(!text)return [];
    const out=[];let begin=0;
    while(begin<text.length&&out.length<250){
      let end=Math.min(text.length,begin+limit);
      if(end<text.length){
        const last=Math.max(text.lastIndexOf('. ',end),text.lastIndexOf('\n',end),text.lastIndexOf(' ',end));
        if(last>begin+limit*.55)end=last+1;
      }
      const value=text.slice(begin,end).trim();
      if(value)out.push(value);
      if(end>=text.length)break;
      begin=end;
    }
    return out;
  }
  function rank(notes,question,tags=[],extraTerms=[]){
    const queries=[...new Set(tokens(question+' '+extraTerms.join(' ')))].slice(0,30);
    const fullQuery=normalize(question).trim();
    const candidates=[];
    for(const n of notes){
      const names=(n.tags||[]).map(id=>tags.find(t=>t.id===id)?.name||'').join(' ');
      const meta=(n.title||'')+' '+names;
      const transcript=chunkText(n.transcript||'',1200);
      const blocks=[
        ...(n.summary?[{kind:'Podsumowanie',body:String(n.summary).slice(0,4200)}]:[]),
        ...(n.sharedText?[{kind:'Udostępniony tekst',body:String(n.sharedText).slice(0,3000)}]:[]),
        ...transcript.map((body,i)=>({kind:'Transkrypcja '+(i+1),body})),
        ...(n.images||[]).filter(img=>img.ocrText?.trim()).flatMap(img=>
          chunkText(img.ocrText,1200).slice(0,12).map((body,i)=>({kind:'OCR: '+(img.name||'obraz')+' '+(i+1),body})))
      ];
      if(!blocks.length&&n.title)blocks.push({kind:'Tytuł',body:n.title});
      for(const block of blocks){
        const hay=normalize(meta+' '+block.body);
        const words=new Set(tokens(hay));
        let score=0;let matched=0;
        for(const term of queries){
          if(words.has(term)){score+=1.8;matched++;}
          else if(term.length>=5&&hay.includes(term)){score+=.9;matched++;}
        }
        if(fullQuery.length>=8&&hay.includes(fullQuery))score+=7;
        score+=Math.min(2,queries.filter(w=>normalize(meta).includes(w)).length*.9);
        if(block.kind==='Podsumowanie')score*=1.3;
        if(matched===0&&score<=0)continue;
        candidates.push({noteId:n.id,title:n.title||'Bez tytułu',kind:block.kind,body:block.body,
          score,matched,createdAt:n.createdAt||0});
      }
    }
    candidates.sort((a,b)=>b.score-a.score||b.matched-a.matched||b.createdAt-a.createdAt);
    const chosen=[];const perNote=new Map();let used=0;
    for(const block of candidates){
      if(chosen.length>=9||used>10500)break;
      const count=perNote.get(block.noteId)||0;
      if(count>=2)continue;
      if(chosen.length>=5&&count>=1)continue;
      const excerpt=block.body.slice(0,1700);
      if(used+excerpt.length>11500)continue;
      chosen.push({...block,body:excerpt});
      used+=excerpt.length;
      perNote.set(block.noteId,count+1);
    }
    const sources=[];const ids=new Map();
    chosen.forEach(item=>{
      if(!ids.has(item.noteId)){
        const key='N'+(ids.size+1);
        ids.set(item.noteId,key);
        sources.push({key,id:item.noteId,title:item.title});
      }
    });
    const context=chosen.map(item=>'['+ids.get(item.noteId)+'] '+item.title+' · '+item.kind+
      '\n'+item.body).join('\n\n===== KOLEJNE ŹRÓDŁO =====\n\n');
    return {context,sources,matches:chosen.length,queryTerms:queries};
  }
  window.GlosLibrarySearch={rank,tokens};
})();