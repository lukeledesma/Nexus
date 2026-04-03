export const DOCK_PINS_STORAGE_KEY = "nexus.dock.pinnedApps"

export const DEFAULT_DOCK_PINS = ["finder"]

/** Keys that may appear in the dock (order preserved in storage). Keep in sync with ApplicationHelper#launcher_grid_entries pin_key values. */
export const PINNABLE_APP_KEYS = new Set([
  "singular-note",
  "singular-task-list",
  "singular-whiteboard",
  "singular-excalidraw",
  "conversion-chart",
  "timer",
  "finder",
  "settings",
  "theme-studio"
])

export function readDockPins() {
  try {
    const raw = localStorage.getItem(DOCK_PINS_STORAGE_KEY)
    if (raw === null || raw === "") return [...DEFAULT_DOCK_PINS]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_DOCK_PINS]
    const seen = new Set()
    const out = []
    for (const k of parsed) {
      if (typeof k !== "string") continue
      const normalizedKey = k === "theme-builder" ? "theme-studio" : k
      if (seen.has(normalizedKey) || !PINNABLE_APP_KEYS.has(normalizedKey)) continue
      seen.add(normalizedKey)
      out.push(normalizedKey)
    }
    return out
  } catch (_) {
    return [...DEFAULT_DOCK_PINS]
  }
}

export function writeDockPins(pins) {
  try {
    localStorage.setItem(DOCK_PINS_STORAGE_KEY, JSON.stringify(pins))
  } catch (_) {}
}

export function toggleDockPinKey(key) {
  if (!PINNABLE_APP_KEYS.has(key)) return readDockPins()
  const pins = [...readDockPins()]
  const i = pins.indexOf(key)
  if (i >= 0) pins.splice(i, 1)
  else pins.push(key)
  writeDockPins(pins)
  return pins
}

export function isPinned(key) {
  return readDockPins().includes(key)
}

/** Tooltip text for dock buttons (matches launcher tile labels). */
export const DOCK_HOVER_LABELS = {
  finder: "Finder",
  "singular-note": "Notepad",
  "singular-task-list": "Tasks",
  "singular-whiteboard": "Sticky Notes",
  "singular-excalidraw": "Sketchpad",
  "conversion-chart": "SAE/METRIC",
  timer: "Timer",
  settings: "Settings",
  "theme-studio": "Theme Studio"
}
