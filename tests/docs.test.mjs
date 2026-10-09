// Regression tests for the docs website (docs/index.html + docs/assets/*).
// Real files, no mocks: every check reads the shipped bytes, so a broken anchor, a lost SRI hash or a
// dangling copy target fails here before it ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const docsDir = fileURLToPath(new URL("../docs", import.meta.url));
const read = (name) => readFileSync(path.join(docsDir, name), "utf8");
const html = read("index.html");

/** Every id= defined in the document, for anchor and aria resolution checks. */
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

test("docs website files exist", () => {
  for (const name of ["index.html", "assets/site.css", "assets/site.js"]) {
    assert.ok(existsSync(path.join(docsDir, name)), `${name} is missing`);
  }
});

test("index.html has the base document contract", () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.ok(html.includes('name="description"'), "meta description is missing");
});

test("every CDN reference is pinned with SRI integrity and crossorigin", () => {
  const refs = [...html.matchAll(/<(?:link|script)[^>]*(?:href|src)="(https:\/\/[^"]+)"[^>]*>/g)];
  assert.ok(refs.length >= 4, "expected the defuss-shadcn CDN assets plus site.js");
  for (const [, url] of refs) {
    assert.match(url, /^https:\/\//, `${url} must be https`);
    if (url.includes("cdn.jsdelivr.net")) {
      const tag = html.split(url)[1].split(">")[0];
      assert.match(tag, /integrity="sha384-[^"]+"/, `${url} lacks an SRI hash`);
      assert.match(tag, /crossorigin="anonymous"/, `${url} lacks crossorigin`);
    }
  }
});

test("every internal anchor resolves to an id", () => {
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(anchors.length > 0, "no internal anchors found");
  for (const anchor of anchors) {
    assert.ok(ids.has(anchor), `anchor #${anchor} has no matching id`);
  }
});

test("every svg use reference resolves to a defined symbol", () => {
  const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  const uses = [...html.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(uses.length > 0, "no svg use references found");
  for (const use of uses) {
    assert.ok(symbols.has(use), `use #${use} has no matching symbol`);
  }
});

test("every copy button has its terminal and its status region", () => {
  const buttons = [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(buttons.length >= 5, "expected the quick-start and usage copy buttons");
  for (const target of buttons) {
    assert.ok(ids.has(target), `data-copy target #${target} is missing`);
    assert.ok(ids.has(`${target}-status`), `status region #${target}-status is missing`);
    const element = html.match(new RegExp(`<([^>]*id="${target}"[^>]*)>`))?.[1] ?? "";
    assert.ok(
      element.includes("mockup-code"),
      `#${target} must be a mockup-code terminal so the copy selector finds command lines`,
    );
  }
});

test("tabs, sheet and dialog wiring resolves", () => {
  for (const [, controls] of html.matchAll(/aria-controls="([^"]+)"/g)) {
    assert.ok(ids.has(controls), `aria-controls target #${controls} is missing`);
  }
  for (const [, labelledby] of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
    assert.ok(ids.has(labelledby), `aria-labelledby target #${labelledby} is missing`);
  }
  for (const [, trigger] of html.matchAll(/data-sheet-trigger="([^"]+)"/g)) {
    assert.ok(ids.has(trigger), `sheet trigger target #${trigger} is missing`);
  }
  assert.ok(ids.has("theme-toggle"), "site.js depends on #theme-toggle");
});

test("local asset references exist on disk", () => {
  for (const [, asset] of html.matchAll(/(?:href|src)="(assets\/[^"]+)"/g)) {
    assert.ok(existsSync(path.join(docsDir, asset)), `${asset} is referenced but missing`);
  }
});

test("no absolute filesystem paths and no leftover reference-page class prefix", () => {
  for (const [name, text] of [["index.html", html], ["assets/site.css", read("assets/site.css")], ["assets/site.js", read("assets/site.js")]]) {
    assert.equal(text.match(/\/Users\/|\/home\/|(?:^|[^A-Za-z])[A-Za-z]:\\/), null, `${name} contains an absolute filesystem path`);
    assert.equal(text.match(/class="[^"]*\bvae-/), null, `${name} still uses the reference page's vae- prefix`);
  }
});
