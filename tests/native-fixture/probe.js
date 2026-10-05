/* Real in-WebView checks; no property spoofing, no headless-browser substitution. */
const runId=window.__DEFUSS_PROBE_RUN_ID;
const checks={};
const wait=async(promise)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Native probe timed out')),20000))]);
const requireCheck=(name,value)=>{checks[name]=value===true;if(value!==true)throw Error(`Failed: ${name}`);};
async function dbValue(write){
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('defuss-probe',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const transaction=db.transaction('state',write===undefined?'readonly':'readwrite');const store=transaction.objectStore('state');const request=write===undefined?store.get('run'):store.put(write,'run');let result;request.onsuccess=()=>result=request.result;transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}finally{db.close();}
}
async function probe(){
  if(typeof runId!=='string')throw Error('This fixture requires a --features probe native binary and the native runner');
  const [nonce,phase]=runId.split(':');const second=phase==='second';
  requireCheck('secure_context',isSecureContext);
  requireCheck('service_worker_api','serviceWorker' in navigator);
  const registration=await wait(navigator.serviceWorker.register('./sw.js'));
  await wait(navigator.serviceWorker.ready);requireCheck('worker_activated',!!registration.active);
  if(!navigator.serviceWorker.controller)await wait(new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})));
  requireCheck('worker_controls_client',!!navigator.serviceWorker.controller);
  requireCheck('worker_intercepts_fetch',(await(await fetch('./__worker_fetch__')).text())==='native-worker-v1');
  requireCheck('missing_worker_404',(await fetch('./missing-worker.js')).status===404);
  const cache=await caches.open('defuss-probe-state');
  if(second){
    requireCheck('stable_origin',localStorage.getItem('probe-origin')===location.origin);
    requireCheck('local_storage_persists',localStorage.getItem('probe-run')===nonce);
    requireCheck('cache_storage_persists',(await(await cache.match('./saved-state'))?.text())===nonce);
    requireCheck('indexeddb_persists',(await dbValue())===nonce);
  }
  localStorage.setItem('probe-origin',location.origin);localStorage.setItem('probe-run',nonce);
  await cache.put('./saved-state',new Response(nonce));await dbValue(nonce);
  requireCheck('storage_writes',localStorage.getItem('probe-run')===nonce&&(await dbValue())===nonce);
}
let error;
try{await wait(probe());}catch(failure){error=String(failure);}
const report={schema:1,runId,status:error?'FAILED':'VERIFIED',checks,origin:location.origin,userAgent:navigator.userAgent,error:error??null};
document.querySelector('#output').textContent=JSON.stringify(report,null,2);
if(typeof runId==='string')location.href='defuss-probe://report/?report='+encodeURIComponent(JSON.stringify(report));
