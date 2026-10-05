import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, symlink, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {resolveConfig} from '../src/config.ts';
import {collectAssets,readAssetSnapshot,hash} from '../src/assets.ts';
import {prepareDefussTauri,buildDefussTauri,devDefussTauri} from '../src/index.ts';
import {writeManaged,initializeManaged} from '../src/managed.ts';
import {fixture} from './helpers.mjs';

test('manifest deterministic; secrets/dependencies omitted, well-known kept',async t=>{
 const root=await fixture(t,{'index.html':'html','ü space.js':'js','.env':'secret','.env.local':'secret','tls/private.key':'secret','.git/config':'secret','.well-known/assetlinks.json':'[]','node_modules/pkg/x.js':'module','target/debug/app':'binary','public/favicon.svg':'svg','coverage/index.html':'coverage'});
 const c=await resolveConfig({projectDir:root});const a=await collectAssets(c);assert.deepEqual(await collectAssets(c),a);
 assert.deepEqual(a.files.map(x=>x.path),['.well-known/assetlinks.json','index.html','public/favicon.svg','ü space.js']);
 assert.equal(a.totalBytes,11);for(const file of a.files)assert.equal(file.sha256,hash(await readFile(join(root,file.path))));
 const snapshot=await readAssetSnapshot(c,a);assert.equal(snapshot.get('index.html').toString(),'html');
 await writeFile(join(root,'index.html'),'changed');await assert.rejects(readAssetSnapshot(c,a),/changed during snapshot/);
});
test('explicit static inclusion is narrow; secret/exclude rules win',async t=>{
 const root=await fixture(t,{'index.html':'x','node_modules/esm/a.js':'a','node_modules/other/b.js':'b','node_modules/esm/private.key':'secret','.data/static.json':'{}'});
 const c=await resolveConfig({projectDir:root,assets:{include:['node_modules/esm','.data'],exclude:['.data']}});
 assert.deepEqual((await collectAssets(c)).files.map(x=>x.path),['index.html','node_modules/esm/a.js']);
 await assert.rejects(collectAssets(await resolveConfig({projectDir:root,assets:{exclude:['index.html']}})),/entry was excluded/);
});
test('URL snapshot is empty even beside application sources',async t=>{
 const root=await fixture(t);const c=await resolveConfig({projectDir:root,target:'http://127.0.0.1:1'});
 assert.deepEqual(await collectAssets(c),{schema:1,files:[],totalBytes:0});assert.equal((await readAssetSnapshot(c,await collectAssets(c))).size,0);
});
test('symlink escapes and internal symlinks are rejected, never dereferenced',async t=>{
 if(process.platform==='win32'){t.skip('symlink creation needs Windows privilege; native Windows gate covers it');return;}
 const root=await fixture(t), outside=await fixture(t);
 await symlink(join(outside,'index.html'),join(root,'bad.js'));await assert.rejects(collectAssets(await resolveConfig({projectDir:root})),/escapes root/);
 await rm(join(root,'bad.js'));await symlink(join(root,'index.html'),join(root,'inside.html'));
 await assert.rejects(collectAssets(await resolveConfig({projectDir:root})),/Symlink asset/);
 // A selected link into an excluded file is rejected, not silently skipped.
 await rm(join(root,'inside.html'));await writeFile(join(root,'.env'),'secret');await symlink(join(root,'.env'),join(root,'alias.js'));
 await assert.rejects(collectAssets(await resolveConfig({projectDir:root})),/Symlink asset/);
 await rm(join(root,'alias.js'));await symlink('missing',join(root,'dangling.js'));
 await assert.rejects(collectAssets(await resolveConfig({projectDir:root})),/Symlink asset/);
 // Excluded entries are never dereferenced: a dangling Emacs lock link must not abort collection.
 await rm(join(root,'dangling.js'));await symlink('user@host.1234',join(root,'.#index.html'));
 assert.deepEqual((await collectAssets(await resolveConfig({projectDir:root}))).files.map(x=>x.path),['index.html']);
});
test('release generation embeds only selected files, no runtime sidecar or shell permissions',async t=>{
 const root=await fixture(t,{'index.html':'<title>hello</title>','main.js':'console.log(1)','private.pem':'secret'});
 const p=await prepareDefussTauri({projectDir:root,command:'build',identifier:'dev.example.demo',appName:"Test App",window:{title:'Quoted " app \\ test'},prepareOnly:true});
 const config=JSON.parse(await readFile(join(p.srcTauriDir,'tauri.conf.json'),'utf8'));
 assert.equal(config.identifier,'dev.example.demo');assert.deepEqual(config.app.security.capabilities,[]);assert.equal(config.app.security.csp,null);assert.equal(config.build.devUrl,undefined);assert.equal(config.bundle.externalBin,undefined);
 const runtime=JSON.parse(await readFile(join(p.srcTauriDir,'runtime.json'),'utf8'));assert.equal(runtime.target.root,null);assert.equal(runtime.window.title,'Quoted " app \\ test');
 assert.deepEqual((await readdir(join(p.srcTauriDir,'assets'))).sort(),['index.html','main.js']);
 const cargo=await readFile(join(p.srcTauriDir,'Cargo.toml'),'utf8');assert.match(cargo,/default = \["static-assets"\]/);assert.doesNotMatch(cargo,/tauri-plugin-shell|\blibc\b/);
 assert.equal(p.manifest.totalBytes,34); // exact source bytes, not directory stat size
 await writeFile(join(root,'main.js'),'changed');await prepareDefussTauri({projectDir:root,command:'build',identifier:'dev.example.demo',appName:"Test App",window:{title:'Quoted " app \\ test'}});
 assert.equal(await readFile(join(p.srcTauriDir,'assets/main.js'),'utf8'),'changed');
});
test('dev source live, release origin separate; regenerating keeps Cargo.lock',async t=>{
 const root=await fixture(t);const options={projectDir:root,identifier:'dev.example.app',prepareOnly:true};
 const dev=(await devDefussTauri(options)).prepared;
 const data=JSON.parse(await readFile(join(dev.srcTauriDir,'runtime.json'),'utf8'));assert.equal(data.target.root,root);assert.equal(data.profileId,'dev.example.app.dev');
 const empty=JSON.parse(await readFile(join(dev.srcTauriDir,'asset-manifest.json'),'utf8'));assert.equal(empty.files.length,0);
 await writeFile(join(dev.srcTauriDir,'Cargo.lock'),'retained');await devDefussTauri(options);assert.equal(await readFile(join(dev.srcTauriDir,'Cargo.lock'),'utf8'),'retained');
 const release=(await buildDefussTauri(options)).prepared;const production=JSON.parse(await readFile(join(release.srcTauriDir,'runtime.json'),'utf8'));assert.notDeepEqual(production.store,data.store);
 // Repeated generation from target=root must not ingest its own output.
 assert.equal(release.manifest.files.length,1);
});
test('URL-only release serializes exact endpoint, selects zero files and disables static feature',async t=>{
 const root=await fixture(t,{});const target='https://127.0.0.1:9/a?token=secret#part';
 const p=await prepareDefussTauri({projectDir:root,target,command:'build'});
 assert.equal(JSON.parse(await readFile(join(p.srcTauriDir,'runtime.json'),'utf8')).target.url,target);
 assert.equal(p.manifest.files.length,0);assert.match(await readFile(join(p.srcTauriDir,'Cargo.toml'),'utf8'),/default = \[\]/);
 assert.equal((await readdir(p.srcTauriDir)).includes('assets'),false);
});
test('dry-run performs no writes even without ownership marker',async t=>{
 const root=await fixture(t);await mkdir(join(root,'.defuss-tauri'));await writeFile(join(root,'.defuss-tauri/custom'),'untouched');
 const before=await readdir(root);await prepareDefussTauri({projectDir:root,dryRun:true});assert.deepEqual(await readdir(root),before);assert.equal(await readFile(join(root,'.defuss-tauri/custom'),'utf8'),'untouched');
 await assert.rejects(prepareDefussTauri({projectDir:root}),/Unowned\/legacy/);
});
test('owned regeneration refuses custom modifications and preserves user data',async t=>{
 const root=await fixture(t,{}),managed=join(root,'managed');const files=new Map([['a.txt',Buffer.from('one')]]);
 await writeManaged(managed,'dev',files);await writeManaged(managed,'dev',new Map([['b.txt',Buffer.from('two')]]));
 assert.deepEqual((await readdir(join(managed,'dev'))).sort(),['b.txt','generated.json']);
 await writeFile(join(managed,'dev/b.txt'),'custom');await assert.rejects(writeManaged(managed,'dev',files),/was edited/);assert.equal(await readFile(join(managed,'dev/b.txt'),'utf8'),'custom');
 await assert.rejects(writeManaged(managed,'../other',files),/Invalid generated profile/);
});
test('ownership, unowned files, deleted files and generation locks fail closed',async t=>{
 const root=await fixture(t,{}),managed=join(root,'managed');const files=new Map([['a.txt',Buffer.from('one')]]);
 await writeManaged(managed,'dev',files);await writeFile(join(managed,'dev/custom.txt'),'custom');
 await assert.rejects(writeManaged(managed,'dev',files),/Unowned file/);await rm(join(managed,'dev/custom.txt'));
 await rm(join(managed,'dev/a.txt'));await assert.rejects(writeManaged(managed,'dev',files),/was deleted/);
 await mkdir(join(managed,'.generation-lock'));await assert.rejects(writeManaged(managed,'release',files),/locked/);await rm(join(managed,'.generation-lock'),{recursive:true});
 await writeFile(join(managed,'owner.json'),'{}');await assert.rejects(initializeManaged(managed),/different owner/);
});

test('literal backslash filenames are rejected before native generation',async t=>{
 if(process.platform==='win32')return;
 const root=await fixture(t);await writeFile(join(root,'a\\b.js'),'ambiguous');
 await assert.rejects(collectAssets(await resolveConfig({projectDir:root})),/non-portable separator/);
});

test('generated profile symlinks cannot redirect writes',async t=>{
 if(process.platform==='win32')return;
 const root=await fixture(t,{}), managed=join(root,'managed'), outside=await fixture(t,{});
 await initializeManaged(managed);await symlink(outside,join(managed,'dev'));
 await assert.rejects(writeManaged(managed,'dev',new Map([['file',Buffer.from('x')]])),/real directory/);
 assert.deepEqual(await readdir(outside),[]);
 // Tauri's gen/ is skipped only as a real directory; a symlinked one would let Tauri write outside the host.
 await rm(join(managed,'dev'));const files=new Map([['src-tauri/a.txt',Buffer.from('x')]]);await writeManaged(managed,'dev',files);
 await symlink(outside,join(managed,'dev/src-tauri/gen'));await assert.rejects(writeManaged(managed,'dev',files),/Symlink in managed project: src-tauri\/gen/);
});

test('mobile hosts embed a snapshot even in dev, sit beside desktop hosts and leave Tauri gen/ alone',async t=>{
 const root=await fixture(t,{'index.html':'<title>m</title>','app.js':'1'});const options={projectDir:root,identifier:'dev.example.app',prepareOnly:true};
 const ios=(await devDefussTauri({...options,platform:'ios'})).prepared;
 assert.match(ios.srcTauriDir,/ios-dev/);assert.match(ios.tauriBundleDir,/gen.apple.build$/);
 assert.equal(JSON.parse(await readFile(join(ios.srcTauriDir,'runtime.json'),'utf8')).target.root,null);
 assert.deepEqual((await readdir(join(ios.srcTauriDir,'assets'))).sort(),['app.js','index.html']);
 const plist=await readFile(join(ios.srcTauriDir,'Info.ios.plist'),'utf8');for(const key of ['NSAllowsLocalNetworking','NSCameraUsageDescription','NSMicrophoneUsageDescription','NSLocationWhenInUseUsageDescription','NSLocalNetworkUsageDescription'])assert.match(plist,new RegExp(key));
 assert.equal(JSON.parse(await readFile(join(ios.srcTauriDir,'tauri.conf.json'),'utf8')).bundle.iOS.minimumSystemVersion,'17.0');
 assert.match(await readFile(join(ios.srcTauriDir,'Cargo.toml'),'utf8'),/crate-type = \["staticlib", "cdylib", "rlib"\]/);
 const android=(await buildDefussTauri({...options,platform:'android'})).prepared;assert.match(android.srcTauriDir,/android-release/);assert.match(android.tauriBundleDir,/outputs$/);
 const desktop=(await devDefussTauri(options)).prepared;assert.equal(JSON.parse(await readFile(join(desktop.srcTauriDir,'runtime.json'),'utf8')).target.root,root);
 await mkdir(join(ios.srcTauriDir,'gen/apple/build'),{recursive:true});await writeFile(join(ios.srcTauriDir,'gen/apple/project.yml'),'tool-owned');
 if(process.platform!=='win32')await symlink('missing',join(ios.srcTauriDir,'gen/apple/Pods'));
 await devDefussTauri({...options,platform:'ios'});assert.equal(await readFile(join(ios.srcTauriDir,'gen/apple/project.yml'),'utf8'),'tool-owned');
});
