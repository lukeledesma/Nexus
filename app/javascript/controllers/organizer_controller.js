import { Controller } from "@hotwired/stimulus"

/** App launcher rows (side panel): toggle windows + reflect `app-window:state`. */
export default class extends Controller {
  connect() {
    this.boundAppWindowState = this.handleAppWindowState.bind(this)
    window.addEventListener("app-window:state", this.boundAppWindowState)
    this.boundSidePanelLayoutChange = this.handleSidePanelLayoutChange.bind(this)
    window.addEventListener("nexus:side-panel-layout-change", this.boundSidePanelLayoutChange)

    this.previewHost = document.getElementById("desktop-side-panel-hover-preview")
    this.previewPinned = false
    this.hidePreviewTimer = null
    this.showPreviewTimer = null
    this.boundPreviewMouseEnter = this.handlePreviewMouseEnter.bind(this)
    this.boundPreviewMouseLeave = this.handlePreviewMouseLeave.bind(this)
    this.boundPreviewMouseOver = this.handlePreviewMouseOver.bind(this)
    this.boundPreviewMouseOut = this.handlePreviewMouseOut.bind(this)
    this.boundPreviewClick = this.handlePreviewClick.bind(this)
    this.previewPeekKey = null
    this.peekHiddenWindows = []
    this.peekRestoreTimer = null
    if (this.previewHost) {
      this.previewHost.addEventListener("mouseenter", this.boundPreviewMouseEnter)
      this.previewHost.addEventListener("mouseleave", this.boundPreviewMouseLeave)
      this.previewHost.addEventListener("mouseover", this.boundPreviewMouseOver)
      this.previewHost.addEventListener("mouseout", this.boundPreviewMouseOut)
      this.previewHost.addEventListener("click", this.boundPreviewClick)
    }

    this.clearRowActiveState()
  }

  disconnect() {
    window.removeEventListener("app-window:state", this.boundAppWindowState)
    window.removeEventListener("nexus:side-panel-layout-change", this.boundSidePanelLayoutChange)
    if (this.previewHost) {
      this.previewHost.removeEventListener("mouseenter", this.boundPreviewMouseEnter)
      this.previewHost.removeEventListener("mouseleave", this.boundPreviewMouseLeave)
      this.previewHost.removeEventListener("mouseover", this.boundPreviewMouseOver)
      this.previewHost.removeEventListener("mouseout", this.boundPreviewMouseOut)
      this.previewHost.removeEventListener("click", this.boundPreviewClick)
    }
    this.endDesktopPeek({ immediate: true })
    this.clearPreviewHideTimer()
    this.clearPreviewShowTimer()
    this.clearPeekRestoreTimer()
    this.clearQueuedPreviewRefreshes()
  }

  async launchApp(event) {
    if (event.target instanceof Element && event.target.closest(".desktop-side-panel-app-action")) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const appKey = event.currentTarget.dataset.windowKey
    if (!appKey) {
      return
    }

    await this.launchAppKey(appKey)
  }

  async launchAppKey(appKey) {
    if (!appKey) return

    const draftOnFirstOpenKeys = new Set([
      "tasks",
      "notes",
      "time-card"
    ])

    const blankOnFirstOpenKeys = new Set([
      "images",
      "audio"
    ])

    if (!draftOnFirstOpenKeys.has(appKey) && !blankOnFirstOpenKeys.has(appKey)) {
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey } }))
      return
    }

    const instances = this.findInstancesForAppRow(appKey)
    if (instances.length > 0) {
      this.expandAndHighlightInstances(instances, appKey)
      return
    }

    if (draftOnFirstOpenKeys.has(appKey)) {
      await this.openEmbeddedDraft(appKey)
      return
    }

    // No instance is open: launch an empty/blank instance for the row app.
    window.dispatchEvent(new CustomEvent("app-window:open", {
      detail: { appKey, forceBlank: true }
    }))
  }

  findInstancesForAppRow(appKey) {
    const selectorByApp = {
      "tasks": 'section.content-window[data-content-window-app-key-value="tasks"], section.content-window[data-content-window-app-key-value^="task-spawn-"]',
      "notes": 'section.content-window[data-content-window-app-key-value="notes"], section.content-window[data-content-window-app-key-value^="note-spawn-"]',
      "time-card": 'section.content-window[data-content-window-app-key-value="time-card"], section.content-window[data-content-window-app-key-value^="time-card-spawn-"]',
      "images": 'section.content-window[data-content-window-app-key-value="images"], section.content-window[data-content-window-app-key-value^="image-spawn-"]',
      "audio": 'section.content-window[data-content-window-app-key-value="audio"]'
    }

    const selector = selectorByApp[appKey]
    if (!selector) return []

    const nodes = Array.from(document.querySelectorAll(selector)).filter((el) => !el.classList.contains("is-hidden"))

    if (!nodes.length) return []

    // Bring back windows from back to front so the final stack order is predictable.
    return nodes.sort((a, b) => {
      const za = Number.parseInt(a.style.zIndex || window.getComputedStyle(a).zIndex || "0", 10)
      const zb = Number.parseInt(b.style.zIndex || window.getComputedStyle(b).zIndex || "0", 10)
      return (Number.isFinite(za) ? za : 0) - (Number.isFinite(zb) ? zb : 0)
    })
  }

  expandAndHighlightInstances(instances, fallbackAppKey) {
    if (!Array.isArray(instances) || instances.length === 0) return

    instances.forEach((windowEl) => {
      const targetAppKey = windowEl.dataset.contentWindowAppKeyValue || fallbackAppKey
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: targetAppKey } }))
    })

    requestAnimationFrame(() => {
      instances.forEach((windowEl) => {
        if (windowEl.classList.contains("is-hidden")) return
        windowEl.classList.remove("content-window--focus-expand")
        void windowEl.offsetWidth
        windowEl.classList.add("content-window--focus-expand")
        if (windowEl.__nexusFocusExpandTimer) window.clearTimeout(windowEl.__nexusFocusExpandTimer)
        windowEl.__nexusFocusExpandTimer = window.setTimeout(() => {
          windowEl.classList.remove("content-window--focus-expand")
          windowEl.__nexusFocusExpandTimer = null
        }, 230)
      })
    })
  }

  noopAppAction(event) {
    event.preventDefault()
    event.stopPropagation()
  }

  showAppPreview(event) {
    const row = event.currentTarget
    if (!(row instanceof Element)) return
    if (!this.previewHost) return

    this.clearPreviewHideTimer()
    this.clearPreviewShowTimer()
    this.previewPinned = false

    // Hover previews are delayed to reduce accidental popup flicker while passing over rows.
    if (event?.type === "mouseenter") {
      this.showPreviewTimer = window.setTimeout(() => {
        this.showPreviewTimer = null
        this.renderAppPreviewForRow(row)
      }, 1000)
      return
    }

    this.renderAppPreviewForRow(row)
  }

  renderAppPreviewForRow(row) {
    if (!(row instanceof Element)) return
    if (!this.previewHost) return

    const appKey = String(row.dataset.windowKey || "").trim()
    if (!appKey) {
      this.hidePreview()
      return
    }

    const appLabel = String(row.dataset.appLabel || appKey).trim()
    const instances = this.findInstancesForAppRow(appKey)
    if (!Array.isArray(instances) || instances.length === 0) {
      this.hidePreview()
      return
    }

    this.previewHost.dataset.previewSourceAppKey = appKey
    this.previewHost.innerHTML = this.buildPreviewMarkup(appLabel, appKey, instances)
    this.positionPreviewNearRow(row)
    this.previewHost.classList.add("is-visible")
    this.previewHost.setAttribute("aria-hidden", "false")
  }

  scheduleHideAppPreview() {
    if (!this.previewHost) return
    this.clearPreviewShowTimer()
    this.clearPreviewHideTimer()
    this.hidePreviewTimer = window.setTimeout(() => {
      if (this.previewPinned) return
      this.hidePreview()
    }, 120)
  }

  handlePreviewMouseEnter() {
    this.previewPinned = true
    this.clearPreviewHideTimer()
  }

  handlePreviewMouseLeave() {
    this.previewPinned = false
    this.clearPreviewActiveRow()
    this.endDesktopPeek({ immediate: true })
    this.scheduleHideAppPreview()
  }

  handlePreviewMouseOver(event) {
    if (!this.isPreviewVisible()) return

    const row = event.target instanceof Element ? event.target.closest("[data-preview-row][data-preview-app-key]") : null
    if (!(row instanceof Element)) return

    const fromRow = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-preview-row][data-preview-app-key]") : null
    if (fromRow === row) return

    const appKey = String(row.dataset.previewAppKey || "").trim()
    if (!appKey) return

    this.setPreviewActiveRow(row)
    this.beginDesktopPeek(appKey)
  }

  handlePreviewMouseOut(event) {
    if (!this.isPreviewVisible()) {
      this.clearPreviewActiveRow()
      this.endDesktopPeek({ immediate: true })
      return
    }

    const row = event.target instanceof Element ? event.target.closest("[data-preview-row][data-preview-app-key]") : null
    if (!(row instanceof Element)) return

    const toRow = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-preview-row][data-preview-app-key]") : null
    if (toRow === row) return
    if (toRow instanceof Element) return

    this.clearPreviewActiveRow()
    this.endDesktopPeek()
  }

  handlePreviewClick(event) {
    const closeTarget = event.target instanceof Element ? event.target.closest("[data-preview-close-app-key]") : null
    if (closeTarget instanceof Element) {
      event.preventDefault()
      event.stopPropagation()

      const closeAppKey = String(closeTarget.dataset.previewCloseAppKey || "").trim()
      if (!closeAppKey) return

      window.dispatchEvent(new CustomEvent("app-window:close", { detail: { appKey: closeAppKey } }))

      // Wait for close animation, then refresh current preview list.
      window.setTimeout(() => {
        const sourceAppKey = String(this.previewHost?.dataset.previewSourceAppKey || "").trim()
        this.refreshPreviewForApp(sourceAppKey)
      }, 320)
      return
    }

    const target = event.target instanceof Element ? event.target.closest("[data-preview-app-key]") : null
    if (!(target instanceof Element)) return

    event.preventDefault()
    event.stopPropagation()

    const appKey = String(target.dataset.previewAppKey || "").trim()
    if (!appKey) return

    this.endDesktopPeek()
    this.focusAndExpandPreviewInstance(appKey)
    this.hidePreview()
  }

  handleSidePanelLayoutChange(event) {
    const isOpen = Boolean(event?.detail?.open)
    if (!isOpen) this.hidePreview()
  }

  hidePreview() {
    if (!this.previewHost) return
    this.clearPreviewShowTimer()
    this.previewHost.classList.remove("is-visible")
    this.previewHost.setAttribute("aria-hidden", "true")
    delete this.previewHost.dataset.previewSourceAppKey
    this.clearPreviewActiveRow()
    this.endDesktopPeek({ immediate: true })
    this.previewPinned = false
  }

  clearPreviewHideTimer() {
    if (!this.hidePreviewTimer) return
    window.clearTimeout(this.hidePreviewTimer)
    this.hidePreviewTimer = null
  }

  clearPreviewShowTimer() {
    if (!this.showPreviewTimer) return
    window.clearTimeout(this.showPreviewTimer)
    this.showPreviewTimer = null
  }

  clearQueuedPreviewRefreshes() {
    if (!Array.isArray(this.previewRefreshTimers) || this.previewRefreshTimers.length === 0) {
      this.previewRefreshTimers = []
      return
    }
    this.previewRefreshTimers.forEach((timer) => window.clearTimeout(timer))
    this.previewRefreshTimers = []
  }

  queuePreviewRefreshForApp(appKey) {
    if (!appKey) return
    this.clearQueuedPreviewRefreshes()

    const refresh = () => this.refreshPreviewIfShowingApp(appKey)
    requestAnimationFrame(refresh)

    this.previewRefreshTimers ||= []
    this.previewRefreshTimers.push(window.setTimeout(refresh, 80))
    this.previewRefreshTimers.push(window.setTimeout(refresh, 220))
  }

  buildPreviewMarkup(appLabel, appKey, instances) {
    const rows = instances.map((windowEl, index) => {
      const instanceKey = String(windowEl.dataset.contentWindowAppKeyValue || appKey)
      const title = this.escapeHtml(this.previewTitleForWindow(windowEl, appLabel, index))
      const escapedInstanceKey = this.escapeHtml(instanceKey)

      return [
        `<div class="desktop-side-panel-hover-preview__row" data-preview-row="true" data-preview-app-key="${escapedInstanceKey}">`,
        `<button type="button" class="desktop-side-panel-hover-preview__open" data-preview-app-key="${escapedInstanceKey}" title="Focus ${title}" aria-label="Focus ${title}">`,
        `<span class="desktop-side-panel-hover-preview__label">${title}</span>`,
        "</button>",
        `<button type="button" class="tools-close-btn content-window-close desktop-side-panel-hover-preview__close" data-preview-close-app-key="${escapedInstanceKey}" data-preview-app-key="${escapedInstanceKey}" title="Close" aria-label="Close"><span class="desktop-side-panel-hover-preview__close-glyph" aria-hidden="true">×</span></button>`,
        "</div>"
      ].join("")
    }).join("")

    return `<div class="desktop-side-panel-hover-preview__rows">${rows}</div>`
  }

  setPreviewActiveRow(row) {
    if (!this.previewHost || !(row instanceof Element)) return
    const active = this.previewHost.querySelector(".desktop-side-panel-hover-preview__row.is-peek-active")
    if (active === row) return
    if (active) active.classList.remove("is-peek-active")
    row.classList.add("is-peek-active")
  }

  clearPreviewActiveRow() {
    if (!this.previewHost) return
    const active = this.previewHost.querySelector(".desktop-side-panel-hover-preview__row.is-peek-active")
    if (active) active.classList.remove("is-peek-active")
  }

  beginDesktopPeek(appKey) {
    if (!appKey) return
    if (!this.isPreviewVisible()) return
    if (!this.previewHost?.matches(":hover")) return
    if (this.previewPeekKey === appKey) return

    this.clearPeekRestoreTimer()
    this.endDesktopPeek({ immediate: true })
    const targetWindow = this.findWindowElementByAppKey(appKey)
    if (!(targetWindow instanceof Element)) return
    if (targetWindow.classList.contains("is-hidden")) return

    this.previewPeekKey = appKey
    const windows = document.querySelectorAll("section.content-window:not(.is-hidden)")
    windows.forEach((windowEl) => {
      if (windowEl === targetWindow) return
      windowEl.dataset.previewPeekDisplay = windowEl.style.display || ""
      windowEl.style.display = "none"
      this.peekHiddenWindows.push(windowEl)
    })
  }

  endDesktopPeek({ immediate = false } = {}) {
    this.previewPeekKey = null
    if (!Array.isArray(this.peekHiddenWindows) || this.peekHiddenWindows.length === 0) return

    if (!immediate) {
      this.clearPeekRestoreTimer()
      this.peekRestoreTimer = window.setTimeout(() => {
        this.restorePeekHiddenWindows()
      }, 220)
      return
    }

    this.restorePeekHiddenWindows()
  }

  clearPeekRestoreTimer() {
    if (!this.peekRestoreTimer) return
    window.clearTimeout(this.peekRestoreTimer)
    this.peekRestoreTimer = null
  }

  restorePeekHiddenWindows() {
    this.clearPeekRestoreTimer()
    if (!Array.isArray(this.peekHiddenWindows) || this.peekHiddenWindows.length === 0) return

    this.peekHiddenWindows.forEach((windowEl) => {
      if (!(windowEl instanceof Element)) return
      const priorDisplay = windowEl.dataset.previewPeekDisplay
      windowEl.style.display = typeof priorDisplay === "string" ? priorDisplay : ""
      delete windowEl.dataset.previewPeekDisplay
    })
    this.peekHiddenWindows = []
  }

  isPreviewVisible() {
    if (!this.previewHost) return false
    return this.previewHost.classList.contains("is-visible") && this.previewHost.getAttribute("aria-hidden") !== "true"
  }

  refreshPreviewForApp(appKey) {
    if (!this.previewHost) return
    if (!appKey) {
      this.hidePreview()
      return
    }

    const row = this.findPanelRowByAppKey(appKey)
    if (!(row instanceof Element)) {
      this.hidePreview()
      return
    }

    const appLabel = String(row.dataset.appLabel || appKey).trim()
    const instances = this.findInstancesForAppRow(appKey)
    if (!Array.isArray(instances) || instances.length === 0) {
      this.hidePreview()
      return
    }

    this.previewHost.innerHTML = this.buildPreviewMarkup(appLabel, appKey, instances)
    this.positionPreviewNearRow(row)
    this.previewHost.classList.add("is-visible")
    this.previewHost.setAttribute("aria-hidden", "false")
  }

  refreshPreviewIfShowingApp(appKey) {
    if (!appKey) return
    if (!this.isPreviewVisible()) return

    const sourceAppKey = String(this.previewHost?.dataset.previewSourceAppKey || "").trim()
    if (sourceAppKey !== String(appKey)) return

    this.refreshPreviewForApp(appKey)
  }

  findPanelRowByAppKey(appKey) {
    const rows = this.element.querySelectorAll("[data-window-key]")
    for (const row of rows) {
      if (String(row.dataset.windowKey || "") === String(appKey)) return row
    }
    return null
  }

  focusAndExpandPreviewInstance(appKey) {
    const windowEl = this.findWindowElementByAppKey(appKey)
    if (!windowEl) {
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey } }))
      return
    }

    if (windowEl.classList.contains("is-hidden")) {
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey } }))
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.applyFocusExpandCue(windowEl)
        })
      })
      return
    }

    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    windowEl.style.zIndex = String(next)
    this.applyFocusExpandCue(windowEl)
  }

  findWindowElementByAppKey(appKey) {
    if (!appKey) return null
    const windows = document.querySelectorAll("section.content-window")
    for (const windowEl of windows) {
      if (String(windowEl.dataset.contentWindowAppKeyValue || "") === String(appKey)) {
        return windowEl
      }
    }
    return null
  }

  applyFocusExpandCue(windowEl) {
    if (!(windowEl instanceof Element)) return
    windowEl.classList.remove("content-window--focus-expand")
    void windowEl.offsetWidth
    windowEl.classList.add("content-window--focus-expand")
    if (windowEl.__nexusFocusExpandTimer) window.clearTimeout(windowEl.__nexusFocusExpandTimer)
    windowEl.__nexusFocusExpandTimer = window.setTimeout(() => {
      windowEl.classList.remove("content-window--focus-expand")
      windowEl.__nexusFocusExpandTimer = null
    }, 230)
  }

  previewTitleForWindow(windowEl, appLabel, index) {
    if (!(windowEl instanceof Element)) return `${appLabel} ${index + 1}`

    const frameId = String(windowEl.dataset.contentWindowFrameIdValue || "").trim()
    const storedTitle = this.readLinkedOpenTitle(frameId)
    if (storedTitle) return storedTitle

    const openFileName = windowEl.querySelector("[data-nexus-open-file-name]")?.textContent
    const normalizedOpenFileName = this.normalizeText(openFileName)
    if (normalizedOpenFileName) return normalizedOpenFileName

    const chromeTitle = windowEl.querySelector(".content-window-chrome-title")?.textContent
    const normalizedChromeTitle = this.normalizeText(chromeTitle)
    if (normalizedChromeTitle) return normalizedChromeTitle

    return `${appLabel} ${index + 1}`
  }

  readLinkedOpenTitle(frameId) {
    if (!frameId) return ""
    const key = `nexus.linkedAppOpenTitle.${frameId}`
    try {
      const sessionValue = window.sessionStorage.getItem(key)
      const sessionTitle = this.normalizeText(sessionValue)
      if (sessionTitle) return sessionTitle
    } catch (_error) {
      // no-op
    }

    try {
      const localValue = window.localStorage.getItem(key)
      return this.normalizeText(localValue)
    } catch (_error) {
      return ""
    }
  }

  normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim()
  }

  positionPreviewNearRow(row) {
    if (!this.previewHost || !(row instanceof Element)) return

    const drawer = row.closest(".desktop-side-panel-drawer")
    if (!(drawer instanceof Element)) return

    const rowRect = row.getBoundingClientRect()
    const drawerRect = drawer.getBoundingClientRect()
    const hostWidth = this.previewHost.offsetWidth || 280
    const hostHeight = this.previewHost.offsetHeight || 160
    const gutter = 10

    let left = Math.round(drawerRect.right + gutter)
    let top = Math.round(rowRect.top - 8)

    const viewportPadding = 8
    const maxLeft = Math.max(viewportPadding, window.innerWidth - hostWidth - viewportPadding)
    const maxTop = Math.max(viewportPadding, window.innerHeight - hostHeight - viewportPadding)

    left = Math.max(viewportPadding, Math.min(left, maxLeft))
    top = Math.max(viewportPadding, Math.min(top, maxTop))

    this.previewHost.style.left = `${left}px`
    this.previewHost.style.top = `${top}px`
  }

  escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
  }

  async addTaskFromPanel(event) {
    event.preventDefault()
    event.stopPropagation()
    await this.openEmbeddedDraft("tasks")
  }

  async addNoteFromPanel(event) {
    event.preventDefault()
    event.stopPropagation()
    await this.openEmbeddedDraft("notes")
  }

  async addTimeCardFromPanel(event) {
    event.preventDefault()
    event.stopPropagation()
    await this.openEmbeddedDraft("time-card")
  }

  async openEmbeddedDraft(appKey) {
    const draft = await this.fetchDraftFile(appKey)
    if (!draft?.document_id) return

    window.dispatchEvent(new CustomEvent("app-window:open", {
      detail: {
        appKey,
        documentId: String(draft.document_id),
        documentTitle: draft.display_title || draft.title || "Draft",
        isDraft: true
      }
    }))

    this.queuePreviewRefreshForApp(appKey)
  }

  async fetchDraftFile(appKey) {
    try {
      const url = `/apps/tasks/draft_file?app_key=${encodeURIComponent(appKey)}`
      const response = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" })
      if (!response.ok) return null
      const payload = await response.json().catch(() => null)
      return payload && payload.ok ? payload : null
    } catch (_error) {
      return null
    }
  }

  handleAppWindowState(event) {
    const appKey = String(event.detail?.appKey || "").trim()
    const panelAppKey = this.panelAppKeyForWindowKey(appKey)

    if (panelAppKey === "tasks") {
      this.updateRowState("tasks", this.anyTaskWindowOpen())
      this.refreshPreviewIfShowingApp("tasks")
      return
    }
    if (panelAppKey === "notes") {
      this.updateRowState("notes", this.anyNoteWindowOpen())
      this.refreshPreviewIfShowingApp("notes")
      return
    }
    if (panelAppKey === "time-card") {
      this.updateRowState("time-card", this.anyTimeCardWindowOpen())
      this.refreshPreviewIfShowingApp("time-card")
      return
    }

    const resolvedKey = panelAppKey || appKey
    this.updateRowState(resolvedKey, Boolean(event.detail?.open))
    this.refreshPreviewIfShowingApp(resolvedKey)
  }

  panelAppKeyForWindowKey(appKey) {
    const key = String(appKey || "").trim()
    if (!key) return ""
    if (key === "tasks" || key.startsWith("task-spawn-")) return "tasks"
    if (key === "notes" || key.startsWith("note-spawn-")) return "notes"
    if (key === "time-card" || key.startsWith("time-card-spawn-")) return "time-card"
    if (key === "images" || key.startsWith("image-spawn-")) return "images"
    return key
  }

  anyTaskWindowOpen() {
    const spawnedOpen = document.querySelector('[data-content-window-app-key-value^="task-spawn-"]:not(.is-hidden)')
    const primaryOpen = document.querySelector('[data-content-window-app-key-value="tasks"]:not(.is-hidden)')
    return Boolean(spawnedOpen || primaryOpen)
  }

  anyNoteWindowOpen() {
    const spawnedOpen = document.querySelector('[data-content-window-app-key-value^="note-spawn-"]:not(.is-hidden)')
    const primaryOpen = document.querySelector('[data-content-window-app-key-value="notes"]:not(.is-hidden)')
    return Boolean(spawnedOpen || primaryOpen)
  }

  anyTimeCardWindowOpen() {
    const spawnedOpen = document.querySelector('[data-content-window-app-key-value^="time-card-spawn-"]:not(.is-hidden)')
    const primaryOpen = document.querySelector('[data-content-window-app-key-value="time-card"]:not(.is-hidden)')
    return Boolean(spawnedOpen || primaryOpen)
  }

  updateRowState(appKey, isOpen) {
    if (!appKey) return
    const button = this.element.querySelector(`[data-window-key="${appKey}"]`)
    if (!button) return
    button.classList.toggle("is-active", isOpen)
    button.setAttribute("aria-pressed", isOpen ? "true" : "false")
  }

  clearRowActiveState() {
    this.element.querySelectorAll("[data-window-key]").forEach((button) => {
      button.classList.remove("is-active")
      button.setAttribute("aria-pressed", "false")
    })
  }
}
