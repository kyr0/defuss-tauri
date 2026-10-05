/** Node's real V8 test coverage; no estimated or hand-entered metric. */
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const result=spawnSync(process.execPath,['--test','--experimental-test-coverage','--test-coverage-include=src/**/*.ts','--test-coverage-exclude=src/cli.ts','--test-coverage-lines=80','tests/config.test.mjs','tests/assets.test.mjs','tests/e2e.test.mjs'],{cwd:root,encoding:'utf8'});
const text=(result.stdout??'')+(result.stderr??'');process.stdout.write(text);
const match=text.match(/(?:#|ℹ) all files\s*\|\s*([\d.]+)/i);
mkdirSync(new URL('../output',import.meta.url),{recursive:true});
writeFileSync(new URL('../output/coverage.txt',import.meta.url),text);
if(!match){console.error('UNKNOWN[coverage]: Node emitted no recognized coverage total');process.exit(2);}
console.log(`TOTAL ${match[1]}%`);
writeFileSync(new URL('../output/coverage.json',import.meta.url),JSON.stringify({schema:1,metric:'V8 executable-line coverage',percent:Number(match[1]),threshold:80,scope:'src modules via Node type stripping; CLI entrypoint and built dist measured by subprocess e2e, not parent-process V8 metric',timestamp:new Date().toISOString()},null,2)+'\n');
process.exit(result.status??2);
