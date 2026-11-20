#!/usr/bin/env node
/**
 * End-to-end check of the Windows system window on a real desktop.
 *
 * It serves a tiny page on 127.0.0.1, starts the shipped helper exactly like the
 * Host does (hidden console, base64 URL, vendored WebView2 SDK, own trace file)
 * and waits for the helper's own trace to prove two things:
 *
 *   form displayed osVisible=True       the window is really on screen
 *   WebView2 initialization completed   the page host came up
 *
 * Only an OS-level check can catch the windowsHide/SW_HIDE class of bug: the
 * form's managed Visible property says True while no window exists, which is
 * what 0.14.2 shipped. Run it on Windows with:
 *
 *   node scripts/check-windows-system-window.mjs
 *
 * Exit codes: 0 = window opened and closed cleanly, 1 = it did not.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HELPER = join(ROOT, "native", "system-window.ps1");
const WEBVIEW2_DIR = join(ROOT, "native", "webview2");
const LOG = join(tmpdir(), "dsh-split-workspace-window-check-" + process.pid + ".log");
const VISIBLE_BUDGET_MS = Number(process.env.DSV_WINDOW_CHECK_MS || 60000);
const INIT_BUDGET_MS = 90000;

if (process.platform !== "win32") {
  console.log("skip - the Windows system window check needs Windows");
  process.exit(0);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const trace = () => {
  try { return readFileSync(LOG, "utf8"); } catch { return ""; }
};

const server = createServer((req, res) => {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end("<!doctype html><meta charset=\"utf-8\"><title>dsh system window check</title>"
    + "<body style=\"margin:0;height:100vh;background:#0f1115;color:#e6edf3;"
    + "font:16px/1.5 system-ui;display:grid;place-items:center\">"
    + "<main><h1>dsh system window check</h1>"
    + "<p>this window is a real OS window hosted by PowerShell + WebView2</p></main></body>");
});
await new Promise((resolve) => { server.listen(0, "127.0.0.1", resolve); });
const port = server.address().port;
const url = "http://127.0.0.1:" + port + "/#dsv-system-window=window-check";

const args = [
  "-NoProfile", "-NonInteractive", "-Sta",
  "-ExecutionPolicy", "Bypass",
  "-File", HELPER,
  "-UrlB64", Buffer.from(url, "utf8").toString("base64"),
  "-WebView2Dir", WEBVIEW2_DIR,
  "-LogPath", LOG,
];
const child = spawn(process.env.DSH_POWERSHELL || "powershell.exe", args, {
  // Exactly what the Host does. This is the setting that hid the window:
  // windowsHide reaches CreateProcess as STARTF_USESHOWWINDOW|SW_HIDE, which
  // Win32 applies to the process's first ShowWindow call.
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: Object.assign({}, process.env, { DSV_HELPER_LOG: LOG }),
});
let output = "";
child.stdout.on("data", (chunk) => { output += String(chunk); });
child.stderr.on("data", (chunk) => { output += String(chunk); });
child.on("error", (error) => { output += "spawn error: " + String(error) + "\n"; });

async function finish(code) {
  const text = trace();
  const profile = /profile dir=([^\r\n]+)/u.exec(text);
  try {
    if (typeof child.pid === "number" && child.pid > 0) {
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    }
  } catch {}
  try { server.close(); } catch {}
  await sleep(400);
  if (profile !== null) {
    try { rmSync(profile[1].trim(), { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
  try { rmSync(LOG, { force: true }); } catch {}
  process.exit(code);
}

/** Wait until the helper proves the window is on screen (or dies trying). */
let state = "timeout";
let hiddenSince = 0;
const visibleDeadline = Date.now() + VISIBLE_BUDGET_MS;
while (Date.now() < visibleDeadline) {
  const text = trace();
  // A hidden first show is followed by the helper's own retry a moment later;
  // do not report "hidden" before that retry has had a chance to land.
  if (/form displayed[^\n]*osVisible=True/u.test(text)) { state = "visible"; break; }
  if (/form displayed[^\n]*osVisible=False/u.test(text)) {
    if (hiddenSince === 0) hiddenSince = Date.now();
    if (Date.now() - hiddenSince > 600) { state = "hidden"; break; }
  }
  if (child.exitCode !== null || child.signalCode !== null) { state = "exited"; break; }
  await sleep(120);
}

if (state !== "visible") {
  const text = trace();
  const reason = state === "hidden"
    ? "the window was created but Windows reports it hidden (osVisible=False)"
    : state === "exited"
      ? "the helper exited before its window was visible (code " + String(child.exitCode) + ")"
      : "no visible window within " + VISIBLE_BUDGET_MS + "ms";
  console.error("not ok - " + reason);
  console.error(text.trim() || output.trim() || "(no helper trace, and no helper output)");
  if (/exiting code=3/u.test(text)) {
    console.error("hint - install the Microsoft Edge WebView2 Runtime, then run this check again");
  }
  await finish(1);
}

console.log("ok - window visible: Windows reports form displayed osVisible=True");

let initialized = false;
const initDeadline = Date.now() + INIT_BUDGET_MS;
while (Date.now() < initDeadline) {
  const text = trace();
  if (text.includes("WebView2 initialization completed")) { initialized = true; break; }
  if (text.includes("WebView2 initialization failed") || text.includes("closing the form")) break;
  if (child.exitCode !== null || child.signalCode !== null) break;
  await sleep(150);
}
if (initialized !== true) {
  console.error("not ok - WebView2 did not initialize inside the visible window");
  console.error(trace().trim() || output.trim() || "(no helper trace)");
  await finish(1);
}
console.log("ok - WebView2 initialization completed");
await sleep(600);
if (/WebView2 navigation requested/u.test(trace())) {
  console.log("ok - the helper navigated the WebView");
} else {
  console.error("not ok - the helper never requested a navigation");
  console.error(trace().trim());
  await finish(1);
}

console.log("ok - closing the window");
await finish(0);
