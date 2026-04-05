/** Capture [appKey → DOMRect] for dock icon buttons inside a zone. */
export function captureDockButtonRects(zoneEl) {
  const m = new Map()
  if (!zoneEl) return m
  zoneEl.querySelectorAll("[data-dock-app-key]").forEach((btn) => {
    m.set(btn.dataset.dockAppKey, btn.getBoundingClientRect())
  })
  return m
}

/** Element → DOMRect for all dock icons + pinned/running divider (same DOM nodes during drag). */
export function captureDockFullLayoutRects(dockEl) {
  const m = new Map()
  if (!dockEl) return m
  const launcherBtn = dockEl.querySelector(".app-dock-button--launcher")
  if (launcherBtn) m.set(launcherBtn, launcherBtn.getBoundingClientRect())
  dockEl
    .querySelectorAll("#app-dock-pinned [data-dock-app-key], #app-dock-running [data-dock-app-key]")
    .forEach((el) => {
      m.set(el, el.getBoundingClientRect())
    })
  const launcherDivider = dockEl.querySelector("#app-dock-launcher-divider")
  if (launcherDivider) {
    const lr = launcherDivider.getBoundingClientRect()
    if (lr.width > 0.5 && lr.height > 0.5) m.set(launcherDivider, lr)
  }
  const divider = dockEl.querySelector("#app-dock-running-divider")
  if (divider && !divider.hidden) m.set(divider, divider.getBoundingClientRect())
  return m
}

/**
 * FLIP any set of dock elements (used when dragging: icons + divider slide together).
 */
export function flipDockFullLayout(prevMap) {
  if (!prevMap || prevMap.size === 0) return
  const duration = 0.28
  const durationMs = duration * 1000
  const els = [...prevMap.keys()].filter((el) => el.isConnected)
  els.forEach((el) => {
    const prev = prevMap.get(el)
    if (!prev) return
    const next = el.getBoundingClientRect()
    const dx = prev.left - next.left
    const dy = prev.top - next.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    el.style.transform = `translate(${dx}px, ${dy}px)`
    el.style.transition = "none"
  })

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      els.forEach((el) => {
        if (!prevMap.has(el)) return
        el.style.transition = `transform ${duration}s cubic-bezier(0.25, 0.82, 0.2, 1)`
        el.style.transform = ""
      })
      window.setTimeout(() => {
        els.forEach((el) => {
          el.style.removeProperty("transition")
          el.style.removeProperty("transform")
        })
      }, durationMs + 50)
    })
  })
}

/** Stable element (e.g. divider) that persists across renderDockApps rebuild. */
export function flipDockSingleElement(prevRect, el) {
  if (!el || !prevRect || !el.isConnected) return
  const next = el.getBoundingClientRect()
  const dx = prevRect.left - next.left
  const dy = prevRect.top - next.top
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
  el.style.transform = `translate(${dx}px, ${dy}px)`
  el.style.transition = "none"
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = "transform 0.28s cubic-bezier(0.25, 0.82, 0.2, 1)"
      el.style.transform = ""
      window.setTimeout(() => {
        el.style.removeProperty("transition")
        el.style.removeProperty("transform")
      }, 320)
    })
  })
}

/**
 * FLIP: animate icons from previous rects to their current layout (slide / settle).
 */
export function flipDockZoneFromPrevRects(prevRects, zoneEl, options = {}) {
  if (!zoneEl) return
  const duration = options.duration ?? 0.28
  const durationMs = duration * 1000
  const buttons = [...zoneEl.querySelectorAll("[data-dock-app-key]")]
  buttons.forEach((btn) => {
    const key = btn.dataset.dockAppKey
    const prev = prevRects.get(key)
    if (!prev) {
      btn.style.opacity = "0"
      btn.style.transition = "none"
      return
    }
    const next = btn.getBoundingClientRect()
    const dx = prev.left - next.left
    const dy = prev.top - next.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    btn.style.transform = `translate(${dx}px, ${dy}px)`
    btn.style.transition = "none"
  })

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      buttons.forEach((btn) => {
        const key = btn.dataset.dockAppKey
        const prev = prevRects.get(key)
        if (!prev) {
          btn.style.transition = `opacity ${duration * 0.85}s ease-out`
          btn.style.opacity = "1"
          return
        }
        btn.style.transition = `transform ${duration}s cubic-bezier(0.25, 0.82, 0.2, 1)`
        btn.style.transform = ""
      })
      window.setTimeout(() => {
        buttons.forEach((btn) => {
          btn.style.removeProperty("transition")
          btn.style.removeProperty("transform")
          btn.style.removeProperty("opacity")
        })
      }, durationMs + 50)
    })
  })
}
