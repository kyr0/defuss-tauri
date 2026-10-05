import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function fixture(t, files = {'index.html': '<!doctype html><title>Fixture</title>'}) {
  // tmpdir() may traverse symlinks (macOS /var -> /private/var); the code under test
  // canonicalizes with realpath, so the fixture must hand out the canonical path too.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'defuss-tauri-test-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(join(root, name, '..'), {recursive: true});
    await writeFile(join(root, name), contents);
  }
  return root;
}
