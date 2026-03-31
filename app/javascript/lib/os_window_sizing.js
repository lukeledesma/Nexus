const DEFAULT_VIEWPORT_MARGIN = 6

export function measureContentHeight(element) {
  if (!element) return 0

  const rectHeight = Math.ceil(element.getBoundingClientRect().height)
  const scrollHeight = Math.ceil(element.scrollHeight)
  if (scrollHeight > 0) return scrollHeight
  return Math.max(rectHeight, 0)
}

export function applyWindowHeight(windowElement, height, options = {}) {
  if (!windowElement) return 0

  const margin = Number.isFinite(options.viewportMargin) ? options.viewportMargin : DEFAULT_VIEWPORT_MARGIN
  const viewportMaxHeight = Math.max(0, window.innerHeight - (margin * 2))
  const targetHeight = Math.max(0, Math.min(Math.ceil(height), viewportMaxHeight))

  windowElement.style.height = `${targetHeight}px`

  const rect = windowElement.getBoundingClientRect()
  const currentTop = Number.parseInt(windowElement.style.top, 10)
  const top = Number.isFinite(currentTop) ? currentTop : Math.round(rect.top)
  const maxTop = Math.max(margin, window.innerHeight - margin - targetHeight)
  const clampedTop = Math.max(margin, Math.min(top, maxTop))
  windowElement.style.top = `${clampedTop}px`

  return targetHeight
}

export function syncOnOpen(windowId, contentElement, windowElement, options = {}) {
  if (!windowElement || !contentElement) return 0

  const measuredHeight = measureContentHeight(contentElement)
  return applyWindowHeight(windowElement, measuredHeight, options)
}

export function observeContent(windowId, contentElement, callback) {
  if (!contentElement || typeof ResizeObserver === "undefined") return null

  const observer = new ResizeObserver(() => {
    if (typeof callback === "function") callback(windowId)
  })
  observer.observe(contentElement)
  return observer
}

export function createOsWindowSizer(config) {
  const {
    windowId,
    windowElement,
    contentElement,
    viewportMargin = DEFAULT_VIEWPORT_MARGIN,
    isWindowOpen = () => true,
    onHeightApplied
  } = config || {}

  if (!windowElement || !contentElement) {
    return {
      sync: () => 0,
      syncOnOpen: () => 0,
      observeContent: () => null,
      disconnect: () => {}
    }
  }

  let observer = null
  let mutationObserver = null
  let syncQueued = false

  const queueSync = () => {
    if (syncQueued) return
    syncQueued = true
    window.requestAnimationFrame(() => {
      syncQueued = false
      sync()
    })
  }

  const onViewportResize = () => {
    if (!isWindowOpen()) return
    const height = syncOnOpen(windowId, contentElement, windowElement, { viewportMargin })
    if (typeof onHeightApplied === "function") onHeightApplied(height)
  }

  const sync = () => {
    if (!isWindowOpen()) return 0
    const height = syncOnOpen(windowId, contentElement, windowElement, { viewportMargin })
    if (typeof onHeightApplied === "function") onHeightApplied(height)
    return height
  }

  const syncNow = () => {
    window.requestAnimationFrame(() => {
      sync()
    })
  }

  return {
    sync,
    syncOnOpen: syncNow,
    observeContent() {
      observer = observeContent(windowId, contentElement, () => {
        queueSync()
      })
      if (typeof MutationObserver !== "undefined") {
        mutationObserver = new MutationObserver(() => {
          queueSync()
        })
        mutationObserver.observe(contentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true
        })
      }
      window.addEventListener("resize", onViewportResize)
      return observer
    },
    disconnect() {
      if (observer) {
        observer.disconnect()
        observer = null
      }
      if (mutationObserver) {
        mutationObserver.disconnect()
        mutationObserver = null
      }
      window.removeEventListener("resize", onViewportResize)
    }
  }
}
