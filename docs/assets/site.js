// The page's own glue: the dark-mode switch and the copy buttons. Every other behavior (sheet menu, tabs,
// parallax, diagram, scroll-to-top) comes from the defuss-shadcn components, wired by their data
// attributes in all.min.js.
// WHY two listeners in a plain module rather than a framework app: docs/ is served as-is without a
// build step, and the components already own their states, so the page adds only what no component does.
// VERIFIED: tests/docs.test.mjs checks the ids and selectors this module depends on against the markup.
const theme = document.getElementById("theme-toggle");

/** Mirrors the saved or OS-default theme into the swap; the pre-paint script in index.html already set
 *  the class, so no flash occurs before this module loads. */
const setTheme = (dark) => {
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  theme.checked = dark;
  // Same key and shape as the defuss-shadcn Dark Mode guide, so the choice carries across defuss pages.
  try {
    localStorage.setItem("defuss-shadcn-theme", JSON.stringify(dark ? "dark" : "light"));
  } catch {
    /* storage may be unavailable (private mode); the choice then lasts only this page view */
  }
};
theme.checked = document.documentElement.classList.contains("dark");
theme.addEventListener("change", () => setTheme(theme.checked));

// Each copy button names its terminal (data-copy); only command lines are copied, never output or prompts.
for (const button of document.querySelectorAll("[data-copy]")) {
  const label = button.querySelector("span");
  const status = document.getElementById(`${button.dataset.copy}-status`);
  button.addEventListener("click", async () => {
    const scope = `#${button.dataset.copy} `;
    const commands = [...document.querySelectorAll(`${scope}pre[data-prefix]:not([data-tone]) code`)];
    // Terminal blocks copy their command lines; file examples (defuss-tauri.json) have no prefixes
    // and copy every non-muted line instead.
    const lines = commands.length ? commands : [...document.querySelectorAll(`${scope}pre:not([data-tone]) code`)];
    try {
      await navigator.clipboard.writeText(lines.map((code) => code.textContent).join("\n"));
      status.textContent = "Copied";
    } catch {
      /* clipboard may be blocked; the failure is reported, never swallowed silently */
      status.textContent = "Copy failed";
    }
    label.textContent = status.textContent;
    setTimeout(() => {
      label.textContent = "Copy";
    }, 2000);
  });
}
