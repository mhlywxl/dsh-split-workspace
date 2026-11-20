/**
 * Quit and relaunch the Desktop app at the OS level: production DSH builds have
 * no in-app restart entry, so the split menu and update chip call this.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { RESTART_COOLDOWN_MS } from "./constants.js";

let lastRestartAt = 0;

/** POSIX single-quote escaping for one shell word. */
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

/**
 * The detached command that closes DSH and opens it again.
 *
 * macOS asks the application to quit through AppleScript, so DSH's own quit
 * confirmation (running tasks) still runs. Windows has no comparable public
 * quit entry, so it closes the main window and then terminates the process;
 * the renderer warns before calling this route.
 */
export function restartCommand() {
  const pid = process.ppid;
  const executable = process.execPath;
  if (process.platform === "darwin") {
    const appBundle = resolve(executable, "../../..");
    return {
      command: "/bin/sh",
      args: ["-c", [
        "sleep 1",
        `osascript -e 'tell application id "com.deepseek.dsh" to quit' >/dev/null 2>&1 || kill -TERM ${pid} 2>/dev/null`,
        `n=0; while kill -0 ${pid} 2>/dev/null && [ $n -lt 120 ]; do n=$((n+1)); sleep 0.5; done`,
        `open ${shellQuote(appBundle)} >/dev/null 2>&1`,
      ].join("; ")],
    };
  }
  if (process.platform === "win32") {
    const script = [
      "Start-Sleep -Milliseconds 900",
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      "if ($p) { $p.CloseMainWindow() | Out-Null; Start-Sleep -Milliseconds 700 }",
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      `if ($p) { Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue }`,
      `for ($i = 0; $i -lt 40; $i++) { if (-not (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }`,
      `Start-Process -FilePath '${String(executable).replace(/'/g, "''")}'`,
    ].join("; ");
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
    };
  }
  return {
    command: "/bin/sh",
    args: ["-c", [
      "sleep 1",
      `kill -TERM ${pid} 2>/dev/null`,
      `n=0; while kill -0 ${pid} 2>/dev/null && [ $n -lt 120 ]; do n=$((n+1)); sleep 0.5; done`,
      `setsid ${shellQuote(executable)} >/dev/null 2>&1 &`,
    ].join("; ")],
  };
}

/** Close and reopen the Desktop app without blocking the HTTP response. */
export function scheduleRestart() {
  const now = Date.now();
  if (now - lastRestartAt < RESTART_COOLDOWN_MS) return false;
  lastRestartAt = now;
  setTimeout(() => {
    try {
      const command = restartCommand();
      spawn(command.command, command.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } catch (error) {
      try { console.warn("[dsh-split-workspace] restart failed:", error); } catch {}
    }
  }, 250);
  return true;
}
