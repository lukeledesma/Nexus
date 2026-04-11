/** Match `.organizer-window.os-window { z-index }` in application.css */
export const ORGANIZER_PANEL_MIN_Z = 1720

function readElementZ(el) {
  const zRaw = el.style.zIndex || window.getComputedStyle(el).zIndex
  return Number.parseInt(zRaw, 10)
}

/** Highest z among visible app windows plus the Ollama helper shell (if present). */
export function maxDesktopFloatingZ() {
  let maxZ = 0
  document.querySelectorAll("section.content-window.os-window:not(.is-hidden)").forEach((el) => {
    const z = readElementZ(el)
    if (Number.isFinite(z) && z > maxZ) maxZ = z
  })
  const helper = document.querySelector(".ollama-helper")
  if (helper) {
    const z = readElementZ(helper)
    if (Number.isFinite(z) && z > maxZ) maxZ = z
  }
  return maxZ
}

/** When the organizer is open, keep it one step above app windows and the helper chat. */
export function syncOrganizerAboveVisibleContentWindows() {
  const org = document.getElementById("organizer-window")
  if (!org || org.classList.contains("is-hidden")) return
  const maxZ = maxDesktopFloatingZ()
  if (maxZ <= 0) return
  const orgZ = Math.max(maxZ + 1, ORGANIZER_PANEL_MIN_Z)
  org.style.zIndex = String(orgZ)
  window.__nexusDesktopZIndex = Math.max(window.__nexusDesktopZIndex || 1500, orgZ)
}
