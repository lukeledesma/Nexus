/**
 * Save-picker Finder loads in an iframe; the Tasks turbo-frame stays in the parent.
 * Custom events and unsaved state must use the OS shell window that runs `workspace-draft-tracker`
 * (not the Finder embed document, and not a nested iframe that is not the shell).
 */
export function linkedAppHostWindow() {
  try {
    let candidate = typeof window !== "undefined" ? window : null
    for (let i = 0; i < 8 && candidate; i += 1) {
      if (typeof candidate.nexusWorkspaceSubstantiveForFrameId === "function") return candidate
      if (candidate.parent && candidate.parent !== candidate) candidate = candidate.parent
      else break
    }
  } catch (_e) {
    /* cross-origin */
  }
  try {
    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
      return window.parent
    }
  } catch (_e) {
    /* cross-origin */
  }
  return typeof window !== "undefined" ? window : globalThis
}

export function dispatchLinkedAppHostEvent(name, detail = {}) {
  linkedAppHostWindow().dispatchEvent(new CustomEvent(name, { detail }))
}

/** `window.confirm` from an embedded Finder iframe is easy to miss; run the dialog on the OS shell. */
export function confirmOnLinkedAppHost(message) {
  const host = linkedAppHostWindow()
  if (host && typeof host.confirm === "function") return host.confirm(message)
  return typeof window !== "undefined" && typeof window.confirm === "function"
    ? window.confirm(message)
    : false
}
