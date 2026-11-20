/**
 * Platform facts: whether this Host runs inside the Desktop shell, and which
 * platforms can host a real, independent OS window from a plugin.
 */
/** True when this Host was spawned by the DSH Desktop shell. */
export function runningInDesktop() {
  return typeof process.versions.electron === "string" && process.versions.electron !== "";
}

/** Platforms that can host a real, independent OS window from the plugin. */
export function nativeWindowSupported(platform) {
  return platform === "darwin" || platform === "win32";
}
