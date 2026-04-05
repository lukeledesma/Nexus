export const DOCK_PINS_STORAGE_KEY = "nexus.dock.pinnedApps"

/** Order of icons in the dock “running” strip (open apps that are not pinned). */
export const DOCK_RUNNING_ORDER_STORAGE_KEY = "nexus.dock.runningOrder"

export const DEFAULT_DOCK_PINS = ["finder"]

/** Keys that may appear in the dock (order preserved in storage). Keep in sync with ApplicationHelper#launcher_grid_entries pin_key values. */
export const PINNABLE_APP_KEYS = new Set([
  "singular-note",
  "singular-task-list",
  "singular-sticky-notes",
  "finder",
  "settings",
  "theme-studio"
])

/** Stable order for dock running-app icons (matches ApplicationHelper#launcher_grid_entries). */
export const DOCK_APP_KEY_ORDER = [
  "singular-note",
  "singular-task-list",
  "singular-sticky-notes",
  "finder",
  "settings",
  "theme-studio"
]

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

/**
 * Remove key from pin list, then insert it before `beforeKey` (if present and valid), else append.
 * Used for dock drag: pin from running, or reorder within pinned.
 */
export function insertPinnedBefore(movedKey, beforeKey) {
  if (!PINNABLE_APP_KEYS.has(movedKey)) return readDockPins()
  const pins = readDockPins().filter((k) => k !== movedKey)
  if (beforeKey && beforeKey !== movedKey && pins.includes(beforeKey)) {
    const i = pins.indexOf(beforeKey)
    pins.splice(i, 0, movedKey)
  } else {
    pins.push(movedKey)
  }
  writeDockPins(pins)
  return pins
}

/** Remove a key from the pin list (dock: drag pinned → running). */
export function removePinnedKey(key) {
  const pins = readDockPins().filter((k) => k !== key)
  writeDockPins(pins)
  return pins
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

export function readDockRunningOrder() {
  try {
    const raw = localStorage.getItem(DOCK_RUNNING_ORDER_STORAGE_KEY)
    if (raw === null || raw === "") return [...DOCK_APP_KEY_ORDER]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DOCK_APP_KEY_ORDER]
    const seen = new Set()
    const out = []
    for (const k of parsed) {
      if (typeof k !== "string" || !PINNABLE_APP_KEYS.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push(k)
    }
    return out.length ? out : [...DOCK_APP_KEY_ORDER]
  } catch (_) {
    return [...DOCK_APP_KEY_ORDER]
  }
}

export function writeDockRunningOrder(orderKeys) {
  try {
    localStorage.setItem(DOCK_RUNNING_ORDER_STORAGE_KEY, JSON.stringify(orderKeys))
  } catch (_) {}
}

/**
 * Reorder running strip: remove key then insert before `beforeKey`, else append.
 * Mirrors insertPinnedBefore for `nexus.dock.runningOrder`.
 */
export function insertRunningBefore(movedKey, beforeKey) {
  if (!PINNABLE_APP_KEYS.has(movedKey)) return readDockRunningOrder()
  const order = readDockRunningOrder().filter((k) => k !== movedKey)
  if (beforeKey && beforeKey !== movedKey && order.includes(beforeKey)) {
    order.splice(order.indexOf(beforeKey), 0, movedKey)
  } else {
    order.push(movedKey)
  }
  writeDockRunningOrder(order)
  return order
}

/**
 * Preserve relative order for apps still open+unpinned; append newly opened keys at the end.
 */
export function mergeOpenRunningOrder(storedOrder, openUnpinnedKeys) {
  const openSet = new Set(openUnpinnedKeys)
  const seen = new Set()
  const out = []
  for (const k of storedOrder) {
    if (!openSet.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  for (const k of openUnpinnedKeys) {
    if (!seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  return out
}

/** Tooltip text for dock buttons (matches launcher tile labels). */
export const DOCK_HOVER_LABELS = {
  finder: "Finder",
  "singular-note": "Notepad",
  "singular-task-list": "Tasks",
  "singular-sticky-notes": "Sticky Notes",
  settings: "Settings",
  "theme-studio": "Theme Studio"
}
