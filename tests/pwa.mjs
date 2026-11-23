import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pkg=JSON.parse(read('package.json'));
const manifest=JSON.parse(read('www/manifest.webmanifest'));
assert.equal(manifest.start_url,'./');
assert.equal(manifest.scope,'./');
assert.equal(manifest.display,'standalone');
assert.equal(manifest.id,'./');
const html=read('www/index.html');
for(const p of ['pwa.js','pwa-backup.js','manifest.webmanifest','vendor/jszip.min.js']){
  assert(html.includes(p),'PWA HTML missing '+p);
}
assert(html.includes('apple-mobile-web-app-capable'),'Safari standalone meta missing');
const sw=read('www/service-worker.js');
assert(sw.includes('self.addEventListener('));
assert(sw.includes('__BUILD_ID__'));
assert(sw.includes("req.method!=='GET'"),'SW must ignore non-GET requests');
assert(sw.includes('scope.origin'),'SW must not intercept external API calls');
const app=read('www/app.js');
assert(app.includes('backup-export')&&app.includes('backup-import'),'Backup actions missing');
assert(app.includes("P.isPWA?.()"),'PWA app UX missing');
assert(read('www/platform.js').includes('isPWA:()=>true'),'PWA platform detection missing');
assert(read('www/pwa-backup.js').includes('glos-pwa-backup'),'Backup format missing');
assert(pkg.scripts.build&&pkg.scripts.check,'Build scripts missing');
console.log('✓ PWA manifest, iPhone meta, navigation and backup contracts: PASS');
