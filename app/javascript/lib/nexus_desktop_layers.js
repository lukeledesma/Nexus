function bumpOllamaHelperAboveWindows() {
  const el = document.querySelector(".ollama-helper")
  if (!el) return
  const winZ = Number(window.__nexusDesktopZIndex || 1500)
  el.style.zIndex = String(Math.max(25000, winZ + 500))
}

/** Layering hook (organizer removed); keeps the crab above stacked app windows. */
export function syncOrganizerAboveVisibleContentWindows() {
  bumpOllamaHelperAboveWindows()
}
