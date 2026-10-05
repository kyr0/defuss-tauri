import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, readdir, symlink, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {resolveConfig, validateConfig} from '../src/config.ts';
import {resolveTarget, relativeAssetPath, inside, describeTarget} from '../src/target.ts';
import {parseArgs} from '../src/args.ts';
import {initDefussTauri, doctorDefussTauri, runDefussTauri} from '../src/index.ts';
import {assertPlatform, configureAndroidProject, mobileProblems, runTool, toolVersion} from '../src/tooling.ts';
import {fixture} from './helpers.mjs';

test('default directory needs neither package.json nor framework', async t => {
  const root = await fixture(t);
  const c = await resolveConfig({projectDir: root});
  assert.deepEqual(c.target, {kind:'directory', root, entry:'index.html'});
  assert.equal(c.profile, 'dev'); assert.equal(c.window.width,1280);
  assert.equal(c.assets.port,null); assert.equal(c.security,'developer');
});
test('configuration location, CLI bases and nested precedence', async t => {
  const root = await fixture(t, {'cfg/site/start.html':'x','override/index.html':'y', 'cfg/defuss-tauri.json':JSON.stringify({target:'./site',window:{width:600,height:500},assets:{spa:true}})});
  const c = await resolveConfig({projectDir:root,config:'cfg/defuss-tauri.json',window:{width:700}});
  assert.equal(c.target.root,join(root,'cfg/site')); assert.equal(c.target.entry,'start.html');
  assert.equal(c.window.width,700);assert.equal(c.window.height,500);assert.equal(c.assets.spa,true);
  assert.equal(c.managedDir,join(root,'cfg/.defuss-tauri'));
  const override=await resolveConfig({projectDir:root,config:'cfg/defuss-tauri.json',target:'override',managedDirName:'gen',command:'build'});
  assert.equal(override.target.root,join(root,'override'));assert.equal(override.managedDir,join(root,'gen'));assert.equal(override.profile,'release');
});
test('URL preserves query, fragment, IPv6 and base path without a connectivity check',async t=>{
  const root=await fixture(t,{}); const url='https://[::1]:4443/a%20b/?secret=123#state';
  const c=await resolveConfig({projectDir:root,target:url,identifier:'dev.example.app'});
  assert.deepEqual(c.target,{kind:'url',url});assert.equal(describeTarget(c.target),'https://[::1]:4443/a%20b/?[redacted]#[redacted]');
  assert.match(c.warnings.join(),/Self-signed/);
  assert.ok((await resolveConfig({projectDir:root,target:'http://192.0.2.1:8123'})).warnings.some(x=>x.includes('Non-loopback')));
  await assert.rejects(resolveConfig({projectDir:root,target:url,assets:{port:3000}}),/only to a directory/);
  await assert.rejects(resolveConfig({projectDir:root,target:url,entry:'index.html'}),/entry/);
});
test('invalid URLs, unsupported schemes and literal secret credentials reject', async t=>{
  const root=await fixture(t);
  for(const value of ['file:///a','ftp://x','http://','https://example.org/a b','https://u:p@example.org/','https://example.org/a\\b','https://example.org/a\u0001','https://example.org/a\u007f']) await assert.rejects(resolveTarget(value,root));
  if(process.platform!=='win32') for(const value of ['C:\\www','\\\\server\\share']) await assert.rejects(resolveTarget(value,root),/Windows/);
});
test('entry choice is deterministic and never searches arbitrary descendants',async t=>{
  const root=await fixture(t,{'one.HTML':'1','two.htm':'2','nested/game.html':'3'});
  await assert.rejects(resolveTarget('.',root),/entry/);
  assert.equal((await resolveTarget('.',root,'nested/game.html')).entry,'nested/game.html');
  await writeFile(join(root,'index.html'),'index');
  assert.equal((await resolveTarget('.',root)).entry,'index.html');
  await assert.rejects(resolveTarget('.',root,'missing.html'));
  await assert.rejects(resolveTarget('.',root,'one.txt'));
  await assert.rejects(resolveTarget('.',root,'../x.html'));
  const empty=await fixture(t,{'nested/index.html':'x'}); await assert.rejects(resolveTarget('.',empty),/entry/);
});
test('path normalization/containment and escaping entry rejection',async t=>{
  const root=await fixture(t), outside=await fixture(t);
  assert.equal(relativeAssetPath('folder\\file.html'),'folder/file.html');
  for(const bad of ['', '/index.html','../x','a/../x','a//b','./x','x\u0000','C:\\file','a:b'])assert.throws(()=>relativeAssetPath(bad));
  assert.equal(inside(root,root+'-outside'),false);assert.equal(inside(root,join(root,'file')),true);
  if(process.platform!=='win32'){
    await symlink(join(outside,'index.html'),join(root,'escape.html'));
    await assert.rejects(resolveTarget('.',root,'escape.html'),/outside|escape|inside/);
  }
});
test('invalid and unknown configuration fields fail early',()=>{
  for(const input of [null,[],true,{wrong:1},{appName:"bad/name"},{target:2},{target:''},{entry:'../a'}, {window:{other:1}},{window:{width:0}},{window:{height:1.5}},{window:{fullscreen:1}},{window:{title:''}},{window:{title:'a\u007f'}},{appName:'a\u0007'},{assets:[]},{assets:{port:0}},{assets:{spa:'yes'}},{assets:{include:'x'}},{assets:{exclude:['..']}},{platform:'web'},{security:'off'},{identifier:'one'},{version:'v1'},{rustTarget:'web'}])assert.throws(()=>validateConfig(input),JSON.stringify(input));
  for(const headers of [{'x-x':'line\r\nInjected:1'},{Host:'x'},{'Content-Length':'0'},{'Transfer-Encoding':'chunked'},{Connection:'close'},{'Content-Range':'bytes 1-2/3'},{'bad header':'x'}])assert.throws(()=>validateConfig({assets:{headers}}));
  assert.doesNotThrow(()=>validateConfig({$schema:'https://example.org/schema',assets:{headers:{'Cross-Origin-Opener-Policy':'same-origin'},include:['a'],exclude:['b']},window:{resizable:false}}));
});
test('normalizes Windows-style include/exclude path prefixes',async t=>{
 const root=await fixture(t);const c=await resolveConfig({projectDir:root,assets:{include:['node_modules\\esm'],exclude:['tmp\\x']}});
 assert.deepEqual(c.assets.include,['node_modules/esm']);assert.deepEqual(c.assets.exclude,['tmp/x']);
});
test('config discovery has no parent search and reports explicit missing/invalid JSON',async t=>{
  const root=await fixture(t,{'defuss-tauri.json':'{ broken','child/index.html':'x'});
  await assert.rejects(resolveConfig({projectDir:root}),/Invalid JSON/);
  assert.equal((await resolveConfig({projectDir:join(root,'child')})).target.kind,'directory');
  await assert.rejects(resolveConfig({projectDir:root,config:'missing.json'}),/ENOENT/);
});
test('generated output may not contain the target or invocation root',async t=>{
 const root=await fixture(t);
 for(const opts of [{managedDirName:'.'},{tauriOutDir:'..'},{managedDirName:'gen',tauriOutDir:'gen/out'},{managedDirName:'gen',tauriOutDir:'gen'}]) await assert.rejects(resolveConfig({projectDir:root,...opts}),/ancestor|distinct/);
 await mkdir(join(root,'public'));await writeFile(join(root,'public/index.html'),'x');
 await assert.rejects(resolveConfig({projectDir:root,target:'public',managedDirName:'public'}),/Target/);
});
test('CLI shapes, options and removed flags',()=>{
 assert.equal(parseArgs([]).options.command,'dev');assert.equal(parseArgs(['site']).options.target,'site');
 assert.equal(parseArgs(['build','site']).options.command,'build');assert.equal(parseArgs(['--','-site']).options.target,'-site');
 assert.equal(parseArgs(['--help']).help,true);
 const x=parseArgs(['build','https://localhost:1','--target=x86_64-unknown-linux-gnu','--rust-target','x86_64-unknown-linux-gnu','--config=c.json','--entry','game.html','--app-name','App','--identifier=a.b','--version=1.2.3','--managed-dir=gen','--tauri-out','out','--platform=native','--strict-security','--debug','--skip-install','--prepare-only','--dry-run']);
 assert.equal(x.options.target,'https://localhost:1');assert.equal(x.options.rustTarget,'x86_64-unknown-linux-gnu');assert.equal(x.options.security,'strict');assert.equal(x.warnings.length,1);
 assert.deepEqual(parseArgs(['-p','3000']).options.assets,{port:3000});
 for(const args of [['--target','a-b-c','--rust-target','d-e-f'],['a','b'],['--unknown'],['--port','abc'],['-p','65536'],['--entry'],['--help=yes'],['--host','x'],['--skip-ssg'],['--node-version=x'],['--skip-node'],['--skip-ssg-install'],['--ssg-output','dist'],['--node-dist-base-url','x']])assert.throws(()=>parseArgs(args),args.join(' '));
});
test('init requires neither HTML nor Rust; safe config-relative CLI rebasing',async t=>{
 const root=await fixture(t,{});
 const result=await initDefussTauri({projectDir:root,config:'cfg/app.json',target:'public',appName:'Example'});
 assert.equal(result.code,'OK');assert.equal(JSON.parse(await readFile(join(root,'cfg/app.json'),'utf8')).target,'../public');
 const original=await readFile(join(root,'cfg/app.json'),'utf8');
 await initDefussTauri({projectDir:root,config:'cfg/app.json',target:'new'});assert.equal(await readFile(join(root,'cfg/app.json'),'utf8'),original);
 const before=await readdir(root);await initDefussTauri({projectDir:root,config:'dry.json',dryRun:true});assert.deepEqual(await readdir(root),before);
 await writeFile(join(root,'bad.json'),'bad');await assert.rejects(initDefussTauri({projectDir:root,config:'bad.json'}));
});
test('doctor dry-run reads but never creates config or native files',async t=>{
 const root=await fixture(t);const before=await readdir(root);
 const report=await doctorDefussTauri({projectDir:root,dryRun:true});assert.equal(report.code,'OK');assert.equal(report.diagnostics.cargo,null);
 assert.match(report.diagnostics.selfSignedTls,/NOT_IMPLEMENTED/);assert.deepEqual(await readdir(root),before);
 assert.equal((await runDefussTauri({projectDir:root,command:'doctor',dryRun:true})).code,'OK');
 await assert.rejects(runDefussTauri({projectDir:root,command:'bogus'}),/Unknown/);
});
test('doctor reports mobile prerequisites even when the target does not resolve',async t=>{
 const root=await fixture(t,{});const report=await doctorDefussTauri({projectDir:root,platform:'android'});
 assert.match(report.diagnostics.configurationError,/HTML/);assert.equal(report.diagnostics.mobile.platform,'android');
 assert.ok(Array.isArray(report.diagnostics.mobile.missing));assert.equal(report.code,'FAILED');
});
test('tooling runs real isolated processes without shell interpolation',async t=>{
 const root=await fixture(t); assert.match(toolVersion(process.execPath),/^v/); assert.equal(toolVersion(join(root,'missing')),null);
 await runTool(process.execPath,['-e',"require('node:fs').writeFileSync('literal;not-shell', 'ok')"],root);
 assert.equal(await readFile(join(root,'literal;not-shell'),'utf8'),'ok');
 await assert.rejects(runTool(process.execPath,['-e','process.exit(7)'],root),/exit=7/);
 await assert.rejects(runTool(join(root,'missing'),[],root),/ENOENT/);
 const c=await resolveConfig({projectDir:root});assert.doesNotThrow(()=>assertPlatform(c));
 assert.throws(()=>assertPlatform({...c,platform:process.platform==='linux'?'windows':'linux'}),/target OS/);
 assert.throws(()=>assertPlatform({...c,rustTarget:process.platform==='linux'?'x86_64-pc-windows-msvc':'x86_64-unknown-linux-gnu'}),/disagree/);
});
test('mobile platforms keep URLs exact and reject unreachable or invalid setups',async t=>{
 const root=await fixture(t);
 const ios=await resolveConfig({projectDir:root,platform:'ios',target:'http://127.0.0.1:5173',identifier:'dev.example.app'});
 assert.equal(ios.mobile,'ios');assert.equal(ios.target.url,'http://127.0.0.1:5173');assert.ok(ios.warnings.some(x=>x.includes('iOS Simulator')));
 await assert.rejects(resolveConfig({projectDir:root,platform:'ios',command:'build',target:'http://localhost:5173'}),/iOS build/);
 assert.equal((await resolveConfig({projectDir:root,platform:'ios',command:'build',target:'http://192.0.2.1:5173'})).target.url,'http://192.0.2.1:5173');
 assert.ok((await resolveConfig({projectDir:root,platform:'android',command:'build',target:'http://127.0.0.1:5173'})).warnings.some(x=>x.includes('adb')));
 await assert.rejects(resolveConfig({projectDir:root,platform:'android',identifier:'dev.my-app.x'}),/Android identifier/);
 assert.equal((await resolveConfig({projectDir:root,platform:'ios',identifier:'dev.my-app.x'})).identifier,'dev.my-app.x');
 await assert.rejects(resolveConfig({projectDir:root,platform:'ios',rustTarget:'aarch64-apple-ios'}),/desktop-only/);
 assert.equal((await resolveConfig({projectDir:root})).mobile,null);assert.equal(parseArgs(['--platform','android']).options.platform,'android');
 if(process.platform==='darwin')assert.doesNotThrow(()=>assertPlatform(ios));else assert.throws(()=>assertPlatform(ios),/iOS builds require macOS/);
 assert.doesNotThrow(()=>assertPlatform({...ios,platform:'android',mobile:'android'}));
});
test('mobile preflight reports every missing prerequisite from real lookups, never installs',async t=>{
 const root=await fixture(t,{});const bare={PATH:root};
 assert.deepEqual(await mobileProblems('android',bare),['rustup is required to check mobile Rust targets','Set ANDROID_HOME to an installed Android SDK','Set NDK_HOME to an installed Android NDK','A Java JDK is required (java on PATH)']);
 assert.deepEqual(await mobileProblems('android',{...bare,ANDROID_SDK_ROOT:root,NDK_HOME:root}),['rustup is required to check mobile Rust targets','A Java JDK is required (java on PATH)']);
 assert.deepEqual(await mobileProblems('ios',bare),['rustup is required to check mobile Rust targets','Xcode is required (xcodebuild)','Missing iOS project tools: brew install xcodegen cocoapods libimobiledevice']);
});
test('android permissive defaults apply only to a project created by this run',async t=>{
 const root=await fixture(t,{});const project=join(root,'android'),main=join(project,'app/src/main'),manifest=join(main,'AndroidManifest.xml');await mkdir(main,{recursive:true});
 // Verbatim lines from tauri-cli 2.12.1 templates/mobile/android/app/src/main/AndroidManifest.xml.
 const template='<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <uses-permission android:name="android.permission.INTERNET" />\n    <application\n        android:usesCleartextTraffic="${usesCleartextTraffic}">\n    </application>\n</manifest>\n';
 await writeFile(manifest,template);
 await configureAndroidProject(project,false);assert.equal(await readFile(manifest,'utf8'),template);await assert.rejects(readFile(join(main,'res/xml/network_security_config.xml')));
 await configureAndroidProject(project,true);const edited=await readFile(manifest,'utf8');
 for(const name of ['CAMERA','RECORD_AUDIO','ACCESS_FINE_LOCATION'])assert.match(edited,new RegExp(`android.permission.${name}"`));
 assert.match(edited,/android.hardware.camera" android:required="false"/);assert.match(edited,/android:networkSecurityConfig="@xml\/network_security_config"/);
 const security=await readFile(join(main,'res/xml/network_security_config.xml'),'utf8');assert.match(security,/cleartextTrafficPermitted="true"/);assert.match(security,/certificates src="user"/);
 await writeFile(manifest,'changed upstream');await rm(join(main,'res/xml'),{recursive:true});await assert.rejects(configureAndroidProject(project,true),/Unexpected Tauri Android template/);
});
