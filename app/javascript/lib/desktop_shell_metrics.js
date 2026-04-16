/** Parses `--os-window-padding` from :root (matches shell content padding). */
export function getOsWindowPaddingPx() {
  const root = document.documentElement
  const s = getComputedStyle(root)
  const v = (s.getPropertyValue("--os-window-padding") || "").trim()
  if (!v) return 12
  if (v.endsWith("rem")) {
    const rem = parseFloat(v, 10)
    const fz = parseFloat(s.fontSize) || 16
    return rem * fz
  }
  if (v.endsWith("px")) return parseFloat(v, 10) || 12
  return 12
}

/** Resolved `--nexus-desktop-shell-inset` in px. */
export function getNexusDesktopShellInsetPx() {
  const root = document.documentElement
  const s = getComputedStyle(root)
  const v = (s.getPropertyValue("--nexus-desktop-shell-inset") || "").trim()
  if (v.endsWith("px")) {
    const px = parseFloat(v)
    if (Number.isFinite(px)) return Math.max(0, Math.round(px))
  }
  const os = getOsWindowPaddingPx()
  return Math.max(8, Math.round(os * 0.65))
}

export function isDesktopSidePanelOpen() {
  return Boolean(document.querySelector(".desktop-side-panel-host--open"))
}

export function getDesktopSidePanelBlockEndPx() {
  if (!isDesktopSidePanelOpen()) return 0
  const drawer = document.querySelector(".desktop-side-panel-drawer")
  if (!drawer) return 0
  const width = drawer.offsetWidth || parseFloat(getComputedStyle(drawer).width) || 0
  if (!Number.isFinite(width) || width <= 0) return 0
  const inset = getNexusDesktopShellInsetPx()
  return Math.round(inset + width + inset)
}
