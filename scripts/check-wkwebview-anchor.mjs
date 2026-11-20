#!/usr/bin/env node
/**
 * Verify the macOS system window's CSS-anchor-positioning fallback in a real
 * WKWebView (the same engine that renders `native/system-window.jxa`).
 *
 * WebKit does not implement `position-anchor` / `anchor()`, so the stock menu
 * CSS collapses to its `top: 12px; left: 12px` fallback and every dropdown
 * paints in the window's top-left corner. The fixture reproduces that state,
 * installs the fallback extracted from `src/client/standalone.js`, and
 * asserts that the panel lands above its trigger instead.
 *
 * It needs macOS + WKWebView, so it runs on demand:
 *
 *   npm run check:anchor
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETUP_HTML_START = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; height: 800px; background: #eee }
#composer { position: fixed; left: 0; right: 0; bottom: 0; height: 120px; background: #ddd }
#trigger { position: absolute; right: 40px; top: 40px; width: 140px; height: 28px }
/* The stock model menu after WebKit drops every anchor() declaration. */
.menu {
  position: fixed;
  position-anchor: var(--dsh-model-anchor);
  top: 12px;
  left: 12px;
  right: anchor(right);
  bottom: calc(anchor(top) + 8px);
  width: 200px;
  height: 200px;
  background: #333;
}
/* The stock menu portal: no shared custom property, only data attributes. */
.stock {
  position: fixed;
  position-anchor: var(--dsh-menu-anchor);
  top: 12px;
  left: 12px;
  right: anchor(right);
  bottom: calc(anchor(top) + 4px);
  width: 180px;
  height: 140px;
  background: #444;
}
</style></head><body>
<div id="composer"><button id="trigger" type="button">model</button></div>
<script>
`;

const DRIVER_HTML = `


(function () {
  const composer = document.getElementById('composer');
  const trigger = document.getElementById('trigger');
  const results = {};
  try {
    // Scenario A: portaled model menu (anchor shared through a custom property).
    trigger.style.setProperty('--dsh-model-anchor', '--dsh-model-fixture');
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.style.setProperty('--dsh-model-anchor', '--dsh-model-fixture');
    document.body.appendChild(menu);
    // Measure the broken state first: without anchor positioning the engine
    // keeps the CSS fallback (12px / 12px) and the menu covers the header.
    const broken = menu.getBoundingClientRect();
    results.before = { top: broken.top, left: broken.left };
    document.body.removeChild(menu);
    const dispose = installAnchorFallback();
    results.disposer = typeof dispose;
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    document.body.appendChild(menu);
    window.setTimeout(function () {
      const panel = menu.getBoundingClientRect();
      const anchor = trigger.getBoundingClientRect();
      results.model = {
        applied: menu.hasAttribute('data-dsv-anchor-fallback'),
        panel: { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right, height: panel.height },
        anchor: { top: anchor.top, bottom: anchor.bottom, left: anchor.left, right: anchor.right },
      };
      document.body.removeChild(menu);

      // Scenario B: stock Menu portal (data-anchor-side/align, trigger learned
      // from the pointerdown that opened it).
      const trigger2 = document.createElement('button');
      trigger2.type = 'button';
      trigger2.style.position = 'absolute';
      trigger2.style.right = '200px';
      trigger2.style.top = '40px';
      trigger2.style.width = '120px';
      trigger2.style.height = '28px';
      composer.appendChild(trigger2);
      trigger2.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      const stock = document.createElement('div');
      stock.className = 'stock';
      stock.setAttribute('data-anchor-side', 'top');
      stock.setAttribute('data-anchor-align', 'end');
      document.body.appendChild(stock);
      window.setTimeout(function () {
        const panel2 = stock.getBoundingClientRect();
        const anchor2 = trigger2.getBoundingClientRect();
        results.stock = {
          applied: stock.hasAttribute('data-dsv-anchor-fallback'),
          panel: { top: panel2.top, bottom: panel2.bottom, left: panel2.left, right: panel2.right, height: panel2.height },
          anchor: { top: anchor2.top, bottom: anchor2.bottom, left: anchor2.left, right: anchor2.right },
        };
        results.supported = cssAnchorPositioningSupported();
        results.viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
        document.title = JSON.stringify(results);
      }, 400);
    }, 400);
  } catch (error) {
    document.title = JSON.stringify({ pageError: String(error) });
  }
})();
</script></body></html>
`;



function readFallback() {
  const source = readFileSync(join(ROOT, "src/client/standalone.js"), "utf8");
  const start = source.indexOf("// dsv-anchor-fallback:start");
  const end = source.indexOf("// dsv-anchor-fallback:end");
  if (start === -1 || end <= start) throw new Error("the anchor fallback markers are missing");
  return source.slice(source.indexOf("\n", start) + 1, end);
}

function closeTo(actual, expected, label) {
  if (typeof actual !== "number" || Math.abs(actual - expected) > 1.5) {
    throw new Error(`${label}: expected about ${expected}, got ${String(actual)}`);
  }
}

function main() {
  if (process.platform !== "darwin") {
    console.log("skipped: the anchor fallback runs in WKWebView, which only exists on macOS");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "dsv-anchor-fallback-"));
  const page = join(dir, "anchor-fallback.html");
  const resultPath = join(dir, "result.json");
  writeFileSync(page, SETUP_HTML_START + readFallback() + DRIVER_HTML);
  let output;
  try {
    execFileSync("/usr/bin/osascript", [
      "-l", "JavaScript",
      join(ROOT, "scripts/anchor-fallback-run.jxa"),
      page,
      resultPath,
    ], { encoding: "utf8", timeout: 60000 });
    output = JSON.parse(readFileSync(resultPath, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (output.timeout === true) throw new Error("the WKWebView fixture timed out");
  if (output.harnessError !== undefined) throw new Error(output.harnessError);
  if (output.pageError !== undefined) throw new Error("fixture page error: " + output.pageError);
  console.log(JSON.stringify(output, null, 2));
  if (output.supported === true) {
    console.log("skipped: this WKWebView already implements CSS anchor positioning");
    return;
  }
  // Root cause: no anchor positioning means the panel sits in the corner.
  closeTo(output.before.top, 12, "broken panel top");
  closeTo(output.before.left, 12, "broken panel left");
  if (output.disposer !== "function") throw new Error("the fallback must return a disposer");

  // The model selector shares its trigger through --dsh-model-anchor: the panel
  // must sit 8px above it, right-aligned, height-capped to the space above.
  if (output.model.applied !== true) throw new Error("the model menu fallback did not apply");
  closeTo(output.model.panel.bottom, output.model.anchor.top - 8, "model panel bottom");
  closeTo(output.model.panel.right, output.model.anchor.right, "model panel right");
  if (output.model.panel.height > output.model.anchor.top - 8 - 12 + 1.5) {
    throw new Error("the fallback did not cap the model menu height");
  }

  // The stock Menu portal only publishes data-anchor-side/align, so the trigger
  // comes from the pointerdown that opened it; same placement, 4px gap.
  if (output.stock.applied !== true) throw new Error("the stock menu fallback did not apply");
  closeTo(output.stock.panel.bottom, output.stock.anchor.top - 4, "stock panel bottom");
  closeTo(output.stock.panel.right, output.stock.anchor.right, "stock panel right");
  if (output.stock.panel.height > output.stock.anchor.top - 4 - 12 + 1.5) {
    throw new Error("the fallback did not cap the stock menu height");
  }

  console.log("ok - WKWebView anchor fallback places stock menus above their trigger");
}

main();
