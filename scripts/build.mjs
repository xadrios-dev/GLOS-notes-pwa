import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const required=[
  'index.html','app.js','platform.js','theme.js','pwa.js','pwa-backup.js',
  'service-worker.js','style.css','dark.css','design-system.css','pwa.css',
  'sync-journal.js','library-search.js','semantic-search.js','manifest.webmanifest',
  'icon-192.png','icon-512.png','icon.svg',
  'vendor/markdown-it.min.js','vendor/purify.min.js',
  'vendor/turndown.min.js','vendor/jszip.min.js'
];
for(const file of required){
  if(!fs.existsSync(path.join('www',file)))throw Error('Brakuje PWA: '+file);
}
const dist=path.join(root,'dist');
fs.rmSync(dist,{recursive:true,force:true});
fs.cpSync(path.join(root,'www'),dist,{recursive:true});
const sha=process.env.GITHUB_SHA?.slice(0,12).replace(/[^0-9a-f]/gi,'');
const version=(sha||pkg.version).replace(/[^A-Za-z0-9.-]/g,'_');
const sw=path.join(dist,'service-worker.js');
const content=fs.readFileSync(sw,'utf8');
if(!content.includes('__BUILD_ID__'))throw Error('Brak znacznika wersji service worker.');
fs.writeFileSync(sw,content.replace('__BUILD_ID__',version));
fs.writeFileSync(path.join(dist,'.nojekyll'),'');
const manifest=JSON.parse(fs.readFileSync(path.join(dist,'manifest.webmanifest'),'utf8'));
if(manifest.start_url!=='./'||manifest.scope!=='./')
  throw Error('Manifest musi być relatywny dla GitHub Pages subpath.');
console.log('✓ Built installable PWA shell; version '+version);
