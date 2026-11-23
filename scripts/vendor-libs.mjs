import fs from 'node:fs';
import path from 'node:path';
// Keep the Markdown engine and HTML sanitizer offline, bundled with the APK.
// Do not load code from CDNs inside an Android WebView.
const vendor=path.resolve('www/vendor');
fs.mkdirSync(vendor,{recursive:true});
for(const [source,name] of [
  ['node_modules/markdown-it/dist/markdown-it.min.js','markdown-it.min.js'],
  ['node_modules/dompurify/dist/purify.min.js','purify.min.js'],
  ['node_modules/turndown/dist/turndown.js','turndown.min.js']
]){
  if(!fs.existsSync(source))throw Error('Brak biblioteki '+source+'; uruchom npm install.');
  fs.copyFileSync(source,path.join(vendor,name));
}
console.log('✓ Local Markdown + HTML sanitizer bundled');
