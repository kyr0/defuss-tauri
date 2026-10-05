import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir, writeFile, readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {fixture} from './helpers.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const cli=join(root,'dist/cli.js');
function run(file,args,cwd){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file,...args],{cwd,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});}
async function evidence(name,result){await mkdir(join(root,'output/e2e'),{recursive:true});await writeFile(join(root,'output/e2e',name+'.json'),JSON.stringify({schema:1,runAt:new Date().toISOString(),...result},null,2)+'\n');}

test('built CLI consumes both minimal configs with a service wholly owned by the test harness',async t=>{
 const project=await fixture(t,{});let requests=0;
 const server=createServer((_req,res)=>{requests++;res.end('external');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const endpoint=`http://127.0.0.1:${server.address().port}/app?token=never-log-this#state`;
 await writeFile(join(project,'defuss-tauri.json'),JSON.stringify({target:endpoint,identifier:'dev.test.offline'}));
 const result=await run(cli,['build','--prepare-only'],project);assert.equal(result.code,0,result.stderr);assert.equal(requests,0);assert.doesNotMatch(result.stdout,/never-log-this/);
 const config=JSON.parse(await readFile(join(project,'.defuss-tauri/release/src-tauri/runtime.json'),'utf8'));assert.equal(config.target.url,endpoint);
 assert.equal(await (await fetch(endpoint)).text(),'external');assert.equal(requests,1); // wrapper exit did not stop service
 const offline=await run(cli,['build','http://127.0.0.1:1','--prepare-only'],project);assert.equal(offline.code,0,offline.stderr);
 await evidence('external-ownership',{status:'VERIFIED',buildPreparationDidNotContactService:true,externalServiceSurvivedCliExit:true,offlineUrlPreparation:true,nativeBuild:'UNKNOWN: native toolchain not exercised by this test'});
});
test('built CLI error codes, dry-run/init, folder preparation and exact serialized data',async t=>{
 const project=await fixture(t,{});
 const init=await run(cli,['init','--app-name','Fixture'],project);assert.equal(init.code,0,init.stderr);assert.deepEqual((await readdir(project)).sort(),['defuss-tauri.json']);
 await writeFile(join(project,'index.html'),'<!doctype html><title>Fixture</title>');
 const before=(await readdir(project)).sort();assert.equal((await run(cli,['build','--dry-run'],project)).code,0);assert.deepEqual((await readdir(project)).sort(),before);
 assert.equal((await run(cli,['doctor','--dry-run'],project)).code,0);assert.deepEqual((await readdir(project)).sort(),before);
 const built=await run(cli,['build','--prepare-only'],project);assert.equal(built.code,0,built.stderr);assert.equal(await readFile(join(project,'.defuss-tauri/release/src-tauri/assets/index.html'),'utf8'),'<!doctype html><title>Fixture</title>');
 assert.equal((await run(cli,['--help'],project)).code,0);assert.equal((await run(cli,['--skip-ssg'],project)).code,1);assert.equal((await run(cli,['--no-such-option'],project)).code,1);
 await evidence('built-cli',{status:'VERIFIED',artifact: 'dist/cli.js',init:true,dryRunNoWrites:true,folderSnapshot:true,migrationErrors:true});
});
