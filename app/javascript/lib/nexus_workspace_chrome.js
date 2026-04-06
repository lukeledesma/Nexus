/**
 * Workspace chrome: ties OS CSS variables to the active saved theme.
 * When `active_theme_id` is `classic`, applies monochrome “Mac Classic” chrome
 * and sets `document.documentElement.dataset.nexusTheme = "classic"` for CSS.
 */

export const NEXUS_CLASSIC_THEME_ID = "classic"

export function isNexusClassicUiActive() {
  return document.documentElement.dataset.nexusTheme === "classic"
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

/** Flat platinum / gray chrome, dark text on light surfaces. */
function applyClassicChrome(root) {
  root.style.setProperty("--window-bg-h", "0")
  root.style.setProperty("--window-bg-saturation", "0%")
  root.style.setProperty("--window-bg-brightness", "78%")
  root.style.setProperty("--window-bg-alpha", "0.98")
  root.style.setProperty("--window-ui-hue", "0")
  root.style.setProperty("--window-ui-saturation", "0%")
  root.style.setProperty("--window-ui-brightness", "70%")

  root.style.setProperty("--desktop-bg-1-hue", "0")
  root.style.setProperty("--desktop-bg-1-saturation", "0%")
  root.style.setProperty("--desktop-bg-1-brightness", "58%")
  root.style.setProperty("--desktop-bg-2-hue", "0")
  root.style.setProperty("--desktop-bg-2-saturation", "0%")
  root.style.setProperty("--desktop-bg-2-brightness", "54%")
  root.style.setProperty("--desktop-bg-angle", "180deg")

  root.style.setProperty("--font-1-tone", "16")
  root.style.setProperty("--font-1-alpha", "1")
  root.style.setProperty("--font-2-tone", "36")
  root.style.setProperty("--font-2-alpha", "1")
}

function applyModernAppearance(root, appearance) {
  const hue = clampInt(appearance.hue, 0, 360, 200)
  const saturation = clampInt(appearance.saturation, 0, 100, 5)
  const brightness = clampInt(appearance.brightness, 0, 100, 20)
  const alpha = clampFloat(appearance.transparency, 0.15, 0.95, 0.18)

  const color1Hue = clampInt(appearance.color_1_hue, 0, 360, 210)
  const color1Sat = clampInt(appearance.color_1_saturation, 0, 100, 18)
  const color1Bri = clampInt(appearance.color_1_brightness, 0, 100, 16)
  const color2Hue = clampInt(appearance.color_2_hue, 0, 360, 195)
  const color2Sat = clampInt(appearance.color_2_saturation, 0, 100, 25)
  const color2Bri = clampInt(appearance.color_2_brightness, 0, 100, 20)
  const angle = clampInt(appearance.angle, 0, 360, 128)

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

/**
 * @param {{ active_theme_id?: string, activeThemeId?: string, appearance?: Record<string, unknown> }} params
 */
export function syncNexusWorkspaceChrome(params) {
  const root = document.documentElement
  const id = String(params?.active_theme_id ?? params?.activeThemeId ?? "default")
  const { appearance } = params || {}

  if (id === NEXUS_CLASSIC_THEME_ID) {
    root.dataset.nexusTheme = "classic"
    applyClassicChrome(root)
    return
  }

  delete root.dataset.nexusTheme
  if (appearance && typeof appearance === "object") {
    applyModernAppearance(root, appearance)
  }
}
