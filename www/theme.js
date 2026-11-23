/* Applied before the first paint to prevent a bright flash at night.
   Preferences use independent keys; older glos_settings backups still work. */
(function(){
  'use strict';
  const MODES=['system','light','dark'];
  const PALETTES=['forest','ocean','violet','sunset'];
  const media=window.matchMedia?.('(prefers-color-scheme: dark)');
  const settings=()=>{try{return JSON.parse(localStorage.getItem('glos_settings')||'{}')||{};}catch{return {};}};
  const stored=(key,legacy,choices,fallback)=>{
    try{const value=localStorage.getItem(key)||settings()[legacy];return choices.includes(value)?value:fallback;}
    catch{return fallback;}
  };
  const get=()=>stored('glos_theme','theme',MODES,'system');
  const getPalette=()=>stored('glos_palette','palette',PALETTES,'forest');
  const themeColors={
    light:{forest:'#f6f8f7',ocean:'#f5f8fc',violet:'#f8f6fc',sunset:'#fbf8f4'},
    dark:{forest:'#11171a',ocean:'#111821',violet:'#17141e',sunset:'#1c1815'}
  };
  const apply=()=>{
    const preference=get();
    const palette=getPalette();
    const resolved=preference==='system'?(media?.matches?'dark':'light'):preference;
    const root=document.documentElement;
    root.dataset.theme=resolved;
    root.dataset.palette=palette;
    root.style.colorScheme=resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',themeColors[resolved][palette]);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content',resolved);
    window.dispatchEvent?.(new CustomEvent('glos-theme-changed',{detail:{preference,resolved,palette}}));
    return {preference,resolved,palette};
  };
  window.GlosTheme={
    apply,get,getPalette,
    palettes:PALETTES.slice(),
    set:mode=>{
      if(!MODES.includes(mode))throw Error('Nieznany motyw');
      localStorage.setItem('glos_theme',mode);
      return apply();
    },
    setPalette:palette=>{
      if(!PALETTES.includes(palette))throw Error('Nieznana paleta kolorów');
      localStorage.setItem('glos_palette',palette);
      return apply();
    }
  };
  try{media?.addEventListener('change',()=>{if(get()==='system')apply();});}catch{}
  apply();
})();
