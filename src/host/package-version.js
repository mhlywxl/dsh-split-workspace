/**
 * The plugin version currently on disk (not the one this process loaded), so a
 * running page notices a freshly installed bundle.
 */
import { readFileSync } from "node:fs";

/** The plugin version currently on disk (not the one this process loaded). */
export function packageVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    return typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : null;
  } catch {
    return null;
  }
}
