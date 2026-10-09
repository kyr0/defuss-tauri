// Syntax highlighting for the code examples, as a progressive enhancement: if the CDN or the
// highlighter fails, every block stays exactly as authored — plain, copyable text.
// WHY per-line token injection instead of codeToHtml: defuss-shadcn's mockup-code renders one <pre>
// per line (prefixes, tones), so the block's own markup must survive; only each line's <code>
// content is replaced with shiki token spans. The terminal chrome is dark in both color schemes,
// so a dark theme reads everywhere. Muted lines are prose comments, not code, and stay plain.
const SHIKI = "https://cdn.jsdelivr.net/npm/shiki@3.23.0";
const THEME = "github-dark-default";
// Entities are assembled at runtime so nothing in this source resembles a decodable entity.
const AMP = String.fromCharCode(38);
const ESCAPES = { "&": AMP + "amp;", "<": AMP + "lt;", ">": AMP + "gt;", '"': AMP + "quot;", "'": AMP + "#39;" };

/** Escapes text for safe insertion into the highlighted HTML. */
const escapeHtml = (text) => text.replace(/[&<>"']/g, (character) => ESCAPES[character]);

try {
  // The dist theme/lang modules re-export through bare package specifiers; the /+esm bundles
  // rewrite those to CDN paths, which is what a browser module import can actually resolve.
  const [{ createHighlighterCore, createJavaScriptRegexEngine }, theme, json, bash] = await Promise.all([
    import(`${SHIKI}/+esm`),
    import(`${SHIKI}/dist/themes/${THEME}.mjs/+esm`),
    import(`${SHIKI}/dist/langs/json.mjs/+esm`),
    import(`${SHIKI}/dist/langs/bash.mjs/+esm`),
  ]);
  // The pure-JavaScript engine keeps the page free of a WebAssembly download.
  const highlighter = await createHighlighterCore({
    themes: [theme.default],
    langs: [json.default, bash.default],
    engine: createJavaScriptRegexEngine(),
  });
  for (const block of document.querySelectorAll(".mockup-code[data-lang]")) {
    const lines = [...block.querySelectorAll("pre:not([data-tone]) > code")];
    if (lines.length === 0) continue;
    const { tokens } = highlighter.codeToTokens(lines.map((code) => code.textContent).join("\n"), {
      lang: block.dataset.lang,
      theme: THEME,
    });
    // A grammar may report fewer lines than input (trailing newline); never write past either end.
    lines.forEach((code, index) => {
      if (tokens[index]) code.innerHTML = tokens[index].map((token) => `<span style="color:${token.color}">${escapeHtml(token.content)}</span>`).join("");
    });
  }
} catch (error) {
  // Bounded, single line: enough to find a broken pin, never a log spray.
  console.warn(`docs highlight unavailable: ${error instanceof Error ? error.message : String(error)}`);
}
