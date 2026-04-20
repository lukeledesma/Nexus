/**
 * Workspace chrome: ties OS CSS variables to the active saved theme.
 */

export const NEXUS_SHELL_MODE_STORAGE_KEY = "nexus.settings.shellMode"
const SHELL_MODE_DARK = "dark"
const SHELL_MODE_LIGHT = "light"
const SHELL_MODE_SYSTEM = "system"
const SHELL_MODE_SET = new Set([SHELL_MODE_DARK, SHELL_MODE_LIGHT, SHELL_MODE_SYSTEM])

const LIGHT_APPEARANCE_OVERRIDES = {
  hue: 212,
  saturation: 24,
  brightness: 92,
  transparency: 0.9,
  font_1: 14,
  font_1_alpha: 100,
  font_2: 34,
  font_2_alpha: 100
}

let lastWorkspaceChromeParams = null
let systemSchemeListenerAttached = false

function normalizedShellMode(rawMode) {
  const mode = String(rawMode || "").trim().toLowerCase()
  return SHELL_MODE_SET.has(mode) ? mode : SHELL_MODE_DARK
}

function readStoredShellMode() {
  try {
    return normalizedShellMode(window.localStorage.getItem(NEXUS_SHELL_MODE_STORAGE_KEY))
  } catch (_error) {
    return SHELL_MODE_DARK
  }
}

function prefersDarkSystemMode() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true
  return Boolean(window.matchMedia("(prefers-color-scheme: dark)").matches)
}

function effectiveShellMode(mode) {
  const normalized = normalizedShellMode(mode)
  if (normalized !== SHELL_MODE_SYSTEM) return normalized
  return prefersDarkSystemMode() ? SHELL_MODE_DARK : SHELL_MODE_LIGHT
}

function attachSystemSchemeListener() {
  if (systemSchemeListenerAttached) return
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
  const query = window.matchMedia("(prefers-color-scheme: dark)")
  if (!query || typeof query.addEventListener !== "function") return

  query.addEventListener("change", () => {
    const requestedMode = normalizedShellMode(lastWorkspaceChromeParams?.shell_mode || readStoredShellMode())
    if (requestedMode !== SHELL_MODE_SYSTEM) return
    syncNexusWorkspaceChrome(lastWorkspaceChromeParams || {})
  })
  systemSchemeListenerAttached = true
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function clampFloat(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function applyModernAppearance(root, appearance) {
  const hue = clampInt(appearance.hue, 0, 360, 200)
  const saturation = clampInt(appearance.saturation, 0, 100, 5)
  const brightness = clampInt(appearance.brightness, 0, 100, 13)
  const alpha = clampFloat(appearance.transparency, 0.15, 1, 0.95)

  // Wallpaper gradient mode is removed; desktop fallback stays black.
  const color1Hue = 0
  const color1Sat = 0
  const color1Bri = 0
  const color2Hue = 0
  const color2Sat = 0
  const color2Bri = 0
  const angle = 180

  const font1 = clampInt(appearance.font_1, 0, 100, 85)
  const font1Alpha = clampInt(appearance.font_1_alpha, 0, 100, 100)
  const font2 = clampInt(appearance.font_2, 0, 100, 60)
  const font2Alpha = clampInt(appearance.font_2_alpha, 0, 100, 100)

  root.style.setProperty("--window-bg-h", String(hue))
  root.style.setProperty("--window-bg-saturation", `${saturation}%`)
  root.style.setProperty("--window-bg-brightness", `${brightness}%`)
  root.style.setProperty("--window-bg-alpha", alpha.toFixed(2))
  root.style.setProperty("--window-ui-hue", String(hue))
  root.style.setProperty("--window-ui-saturation", `${saturation}%`)
  root.style.setProperty("--window-ui-brightness", `${brightness}%`)
  root.style.setProperty("--desktop-bg-1-hue", String(color1Hue))
  root.style.setProperty("--desktop-bg-1-saturation", `${color1Sat}%`)
  root.style.setProperty("--desktop-bg-1-brightness", `${color1Bri}%`)
  root.style.setProperty("--desktop-bg-2-hue", String(color2Hue))
  root.style.setProperty("--desktop-bg-2-saturation", `${color2Sat}%`)
  root.style.setProperty("--desktop-bg-2-brightness", `${color2Bri}%`)
  root.style.setProperty("--desktop-bg-angle", `${angle}deg`)
  root.style.setProperty("--font-1-tone", String(font1))
  root.style.setProperty("--font-1-alpha", (font1Alpha / 100).toFixed(2))
  root.style.setProperty("--font-2-tone", String(font2))
  root.style.setProperty("--font-2-alpha", (font2Alpha / 100).toFixed(2))
}

function applyLightAppearance(root, appearance) {
  applyModernAppearance(root, {
    ...(appearance || {}),
    ...LIGHT_APPEARANCE_OVERRIDES
  })
}

/**
 * @param {{ active_theme_id?: string, activeThemeId?: string, appearance?: Record<string, unknown> }} params
 */
export function syncNexusWorkspaceChrome(params) {
  attachSystemSchemeListener()
  const nextParams = params || {}
  const mergedParams = {
    ...(lastWorkspaceChromeParams || {}),
    ...nextParams
  }
  lastWorkspaceChromeParams = mergedParams

  const root = document.documentElement
  const { appearance } = mergedParams
  const requestedShellMode = normalizedShellMode(mergedParams.shell_mode || readStoredShellMode())
  const mode = effectiveShellMode(requestedShellMode)

  root.dataset.nexusShellMode = mode
  delete root.dataset.nexusTheme
  if (mode === SHELL_MODE_LIGHT) {
    applyLightAppearance(root, appearance)
    window.dispatchEvent(new CustomEvent("nexus:workspace-chrome-synced", { detail: { mode } }))
    return
  }
  if (appearance && typeof appearance === "object") {
    applyModernAppearance(root, appearance)
  }
  window.dispatchEvent(new CustomEvent("nexus:workspace-chrome-synced", { detail: { mode } }))
}

/**
 * Desktop `#desktop`: gradient (CSS) or wallpaper image (`background-size: cover`) from `/documents/:id/asset_file`.
 * @param {{ wallpaper_background_kind?: string | null, wallpaper_image_document_id?: number | string | null }} params
 */
export function syncNexusDesktopWallpaper(params) {
  const el = document.getElementById("desktop")
  if (!el) return

  const kind = String(params?.wallpaper_background_kind ?? "").toLowerCase()
  const rawId = params?.wallpaper_image_document_id
  const n = rawId != null ? Number.parseInt(String(rawId), 10) : 0
  const docId = Number.isFinite(n) && n > 0 ? n : 0

  if (kind === "image" && docId > 0) {
    const url = `/documents/${docId}/asset_file`
    el.style.backgroundColor = "#000"
    el.style.backgroundImage = `url("${url}")`
    el.style.backgroundSize = "cover"
    el.style.backgroundPosition = "center"
    el.style.backgroundRepeat = "no-repeat"
    el.dataset.nexusWallpaper = "image"
    return
  }

  el.style.removeProperty("background-color")
  el.style.removeProperty("background-image")
  el.style.removeProperty("background-size")
  el.style.removeProperty("background-position")
  el.style.removeProperty("background-repeat")
  delete el.dataset.nexusWallpaper
}
