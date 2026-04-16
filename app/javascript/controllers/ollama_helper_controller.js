import { Controller } from "@hotwired/stimulus"
import { getNexusDesktopShellInsetPx } from "lib/desktop_shell_metrics"
import { syncOrganizerAboveVisibleContentWindows } from "lib/nexus_desktop_layers"

/** Kept in sync with inline boot script in `shared/_ollama_helper.html.erb` (early left/top). */
const STORAGE_POS = "nexus.ollamaHelper.position"
const STORAGE_OPEN = "nexus.ollamaHelper.open"
const DRAG_THRESHOLD_PX = 6
/* Treat dock as “hugging” an edge within this px so left/top pins win over right/bottom when both overflow. */
const DOCK_EDGE_HUG_PX = 3

/** @typedef {"none"|"left"|"right"} DockPinX */
/** @typedef {"none"|"top"|"bottom"} DockPinY */

const SPRITE_VALUE = {
  idle: "spriteIdle",
  sleep: "spriteSleep",
  thinking: "spriteThinking",
  typing: "spriteTyping",
  happy: "spriteHappy",
  error: "spriteError",
  juggling: "spriteJuggling",
  reading: "spriteReading"
}

export default class extends Controller {
  static targets = [
    "root",
    "dock",
    "panel",
    "pet",
    "messages",
    "input",
    "status",
    "mascot"
  ]

  static values = {
    chatUrl: String,
    spriteIdle: String,
    spriteSleep: String,
    spriteThinking: String,
    spriteTyping: String,
    spriteHappy: String,
    spriteError: String,
    spriteJuggling: String,
    spriteReading: String
  }

  connect() {
    this.history = []
    this.visualState = "idle"
    this._sleepTimer = null
    this._flashTimer = null
    this._typingShowTimer = null
    this._moodTimer = null
    this._varietyInterval = null

    this._petPtr = null
    this._petDragging = false
    this._petDragReady = false
    this._dockDragOffset = { x: 0, y: 0 }

    this._dockPositionReady = false
    /** @type {DockPinX} */
    this._dockPinX = "none"
    /** @type {DockPinY} */
    this._dockPinY = "none"
    this._dockLeft = 0
    this._dockTop = 0

    this._onPetMove = this.handlePetMove.bind(this)
    this._onPetUp = this.handlePetUp.bind(this)
    this._onOutsidePointerDown = this.handleOutsidePointerDown.bind(this)
    this._bubbleRaf = null
    this.onResize = () => {
      this.reconcileDockOnResize()
      this.scheduleBubblePlacement()
    }

    this.restoreState()
    this.onEscape = (e) => {
      if (e.key === "Escape" && this.rootTarget.classList.contains("ollama-helper--open")) this.close()
    }
    window.addEventListener("keydown", this.onEscape)
    window.addEventListener("resize", this.onResize)

    this.setVisual("idle", { force: true })
    this.bumpActivity()
    this._varietyInterval = window.setInterval(() => this.maybeIdleVariety(), 32_000)
    requestAnimationFrame(() => {
      this.bootstrapDockFromDomIfNeeded()
      this.clampSpawnIfOffScreen()
      this.reconcileDockOnResize()
      syncOrganizerAboveVisibleContentWindows()
      this.updateBubblePlacement()
      this.resizeTextarea()
      if (!this._dockPositionReady) {
        requestAnimationFrame(() => {
          this.bootstrapDockFromDomIfNeeded()
          this.clampSpawnIfOffScreen()
          this.reconcileDockOnResize()
          syncOrganizerAboveVisibleContentWindows()
          this.updateBubblePlacement()
        })
      }
    })
  }

  disconnect() {
    this.detachOutsideCloseListener()
    this.detachPetListeners()
    window.removeEventListener("keydown", this.onEscape)
    window.removeEventListener("resize", this.onResize)
    this.clearTimers()
    if (this._varietyInterval) {
      window.clearInterval(this._varietyInterval)
      this._varietyInterval = null
    }
  }

  detachPetListeners() {
    window.removeEventListener("pointermove", this._onPetMove)
    window.removeEventListener("pointerup", this._onPetUp)
    window.removeEventListener("pointercancel", this._onPetUp)
  }

  clearTimers() {
    ;["_sleepTimer", "_flashTimer", "_typingShowTimer", "_moodTimer"].forEach((k) => {
      const t = this[k]
      if (t) window.clearTimeout(t)
      this[k] = null
    })
  }

  urlForVisual(name) {
    const key = SPRITE_VALUE[name]
    if (!key) return this.spriteIdleValue
    const camel = `${key}Value`
    return this[camel] || this.spriteIdleValue
  }

  applyMascotUrl(url) {
    if (!this.hasMascotTarget) return
    const img = this.mascotTarget
    try {
      if (new URL(img.src).pathname === url) return
    } catch { /* ignore */ }
    img.src = url
  }

  setVisual(name, { force = false } = {}) {
    if (!force && this.rootTarget.classList.contains("ollama-helper--loading") && name !== "thinking") return

    this.visualState = name
    this.applyMascotUrl(this.urlForVisual(name))
  }

  bumpActivity() {
    if (this._sleepTimer) window.clearTimeout(this._sleepTimer)
    if (this.visualState === "sleep") this.setVisual("idle", { force: true })
    this._sleepTimer = window.setTimeout(() => this.tryEnterSleep(), 60_000)
  }

  tryEnterSleep() {
    if (this.rootTarget.classList.contains("ollama-helper--loading")) return
    const busy = ["thinking", "happy", "error", "juggling", "reading", "typing"]
    if (busy.includes(this.visualState)) return
    this.setVisual("sleep", { force: true })
  }

  maybeIdleVariety() {
    if (this.rootTarget.classList.contains("ollama-helper--loading")) return
    if (this.visualState !== "idle") return
    if (Math.random() > 0.22) return

    const open = this.rootTarget.classList.contains("ollama-helper--open")
    const next = open ? "reading" : "juggling"
    this.flashVisual(next, open ? 5200 : 4200)
  }

  flashVisual(name, ms) {
    window.clearTimeout(this._flashTimer)
    this.setVisual(name, { force: true })
    this._flashTimer = window.setTimeout(() => {
      this._flashTimer = null
      if (this.visualState === name && !this.rootTarget.classList.contains("ollama-helper--loading")) {
        this.setVisual("idle", { force: true })
      }
    }, ms)
  }

  resizeTextarea() {
    if (!this.hasInputTarget) return
    const ta = this.inputTarget
    const cs = getComputedStyle(ta)
    const line = parseFloat(cs.lineHeight)
    const lineH = Number.isFinite(line) && line > 0 ? line : 1.35 * (parseFloat(cs.fontSize) || 13)
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    const minH = Math.ceil(lineH + padY)
    const maxH = Math.ceil(lineH * 3 + padY)
    ta.style.height = "auto"
    ta.style.overflowY = "hidden"
    const sh = ta.scrollHeight
    const next = Math.min(maxH, Math.max(minH, sh))
    ta.style.height = `${next}px`
    ta.style.overflowY = sh > maxH ? "auto" : "hidden"
    this.scheduleBubblePlacement()
  }

  onInput() {
    this.resizeTextarea()
    this.bumpActivity()
    window.clearTimeout(this._typingShowTimer)
    if (!this.hasInputTarget) return
    const v = this.inputTarget.value.trim()
    if (!v) {
      if (this.visualState === "typing") this.setVisual("idle", { force: true })
      return
    }
    this._typingShowTimer = window.setTimeout(() => {
      this._typingShowTimer = null
      if (this.rootTarget.classList.contains("ollama-helper--loading")) return
      const block = ["juggling", "reading", "happy", "error", "thinking", "sleep"]
      if (block.includes(this.visualState)) return
      this.setVisual("typing", { force: true })
    }, 450)
  }

  onInputBlur() {
    window.clearTimeout(this._typingShowTimer)
    this._typingShowTimer = null
    if (this.visualState === "typing") this.setVisual("idle", { force: true })
  }

  onPetPointerDown(event) {
    if (event.button !== 0) return
    event.preventDefault()
    this.bumpActivity()
    this._petPtr = { x: event.clientX, y: event.clientY }
    this._petDragging = false
    this._petDragReady = false
    window.addEventListener("pointermove", this._onPetMove)
    window.addEventListener("pointerup", this._onPetUp)
    window.addEventListener("pointercancel", this._onPetUp)
  }

  handlePetMove(event) {
    if (!this._petPtr) return
    const dx = event.clientX - this._petPtr.x
    const dy = event.clientY - this._petPtr.y
    const d2 = dx * dx + dy * dy

    if (!this._petDragReady && d2 >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      this._petDragReady = true
      this._petDragging = true
      const dock = this.dockTarget
      const r = dock.getBoundingClientRect()
      this._dockPinX = "none"
      this._dockPinY = "none"
      this._dockLeft = r.left
      this._dockTop = r.top
      this._dockPositionReady = true
      this.applyDockPixelPosition()
      this._dockDragOffset = {
        x: event.clientX - r.left,
        y: event.clientY - r.top
      }
      this.petTarget.classList.add("ollama-helper__pet--grabbing")
    }

    if (this._petDragging) {
      this.moveDockTo(event.clientX - this._dockDragOffset.x, event.clientY - this._dockDragOffset.y)
      this.scheduleBubblePlacement()
    }
  }

  handlePetUp() {
    this.detachPetListeners()
    const wasDrag = this._petDragging
    const ptr = this._petPtr
    this._petPtr = null
    this._petDragging = false
    this._petDragReady = false
    this.petTarget.classList.remove("ollama-helper__pet--grabbing")

    if (wasDrag) {
      this.finalizeDockAfterDrag()
      this.updateBubblePlacement()
      return
    }
    if (ptr) this.toggle()
  }

  /** Left edge of draggable crab dock (shell inset + side panel block when open). */
  crabLeftMinPx() {
    return getNexusDesktopShellInsetPx()
  }

  moveDockTo(left, top) {
    const dock = this.dockTarget
    const w = dock.offsetWidth
    const h = dock.offsetHeight
    const m = getNexusDesktopShellInsetPx()
    const lx = this.crabLeftMinPx()
    const maxL = Math.max(lx, window.innerWidth - w - m)
    const maxT = Math.max(m, window.innerHeight - h - m)
    const cl = Math.min(Math.max(lx, left), maxL)
    const ct = Math.min(Math.max(m, top), maxT)
    this._dockLeft = cl
    this._dockTop = ct
    this._dockPositionReady = true
    dock.style.left = `${cl}px`
    dock.style.top = `${ct}px`
    dock.style.right = "auto"
    dock.style.bottom = "auto"
  }

  applyDockPixelPosition() {
    if (!this.hasDockTarget) return
    const dock = this.dockTarget
    dock.style.left = `${Math.round(this._dockLeft)}px`
    dock.style.top = `${Math.round(this._dockTop)}px`
    dock.style.right = "auto"
    dock.style.bottom = "auto"
  }

  persistDockState() {
    if (!this._dockPositionReady) return
    try {
      localStorage.setItem(
        STORAGE_POS,
        JSON.stringify({
          left: Math.round(this._dockLeft),
          top: Math.round(this._dockTop),
          pinX: this._dockPinX,
          pinY: this._dockPinY
        })
      )
    } catch {
      /* ignore */
    }
  }

  /**
   * Float at a fixed viewport position until an edge would clip the dock; then stick to that edge
   * so further resize along that axis moves the crab with the border. Pins clear on drag.
   */
  reconcileDockOnResize() {
    if (!this.hasDockTarget || this._petDragging || !this._dockPositionReady) return

    const iw = window.innerWidth
    const ih = window.innerHeight
    const m = getNexusDesktopShellInsetPx()
    const lx = this.crabLeftMinPx()
    const dock = this.dockTarget
    const w = dock.offsetWidth
    const h = dock.offsetHeight
    if (w < 1 || h < 1) return

    let left = this._dockLeft
    let top = this._dockTop
    let pinX = this._dockPinX
    let pinY = this._dockPinY

    if (w + 2 * m > iw) {
      left = lx
      pinX = "left"
    }
    if (h + 2 * m > ih) {
      top = m
      pinY = "top"
    }

    if (pinX === "right") {
      left = iw - w - m
    } else if (pinX === "left") {
      left = lx
    } else {
      const overflowRight = left + w > iw - m
      const overflowLeft = left < lx
      const hugLeft = left <= lx + DOCK_EDGE_HUG_PX
      const hugRight = left + w >= iw - m - DOCK_EDGE_HUG_PX

      if (overflowLeft && overflowRight) {
        const gapL = left - lx
        const gapR = iw - m - (left + w)
        if (gapL <= gapR) {
          left = lx
          pinX = "left"
        } else {
          left = iw - w - m
          pinX = "right"
        }
      } else if (overflowRight && hugLeft) {
        left = lx
        pinX = "left"
      } else if (overflowLeft && hugRight) {
        left = iw - w - m
        pinX = "right"
      } else if (overflowRight) {
        left = iw - w - m
        pinX = "right"
      } else if (overflowLeft) {
        left = lx
        pinX = "left"
      }
    }

    if (pinY === "bottom") {
      top = ih - h - m
    } else if (pinY === "top") {
      top = m
    } else {
      const overflowBottom = top + h > ih - m
      const overflowTop = top < m
      const hugTop = top <= m + DOCK_EDGE_HUG_PX
      const hugBottom = top + h >= ih - m - DOCK_EDGE_HUG_PX

      if (overflowTop && overflowBottom) {
        const gapT = top - m
        const gapB = ih - m - (top + h)
        if (gapT <= gapB) {
          top = m
          pinY = "top"
        } else {
          top = ih - h - m
          pinY = "bottom"
        }
      } else if (overflowBottom && hugTop) {
        top = m
        pinY = "top"
      } else if (overflowTop && hugBottom) {
        top = ih - h - m
        pinY = "bottom"
      } else if (overflowBottom) {
        top = ih - h - m
        pinY = "bottom"
      } else if (overflowTop) {
        top = m
        pinY = "top"
      }
    }

    const maxL = Math.max(lx, iw - w - m)
    const maxT = Math.max(m, ih - h - m)
    left = Math.min(Math.max(lx, left), maxL)
    top = Math.min(Math.max(m, top), maxT)

    this._dockLeft = left
    this._dockTop = top
    this._dockPinX = pinX
    this._dockPinY = pinY
    this.applyDockPixelPosition()
    this.persistDockState()
  }

  bootstrapDockFromDomIfNeeded() {
    if (!this.hasDockTarget || this._dockPositionReady) return
    const r = this.dockTarget.getBoundingClientRect()
    this._dockLeft = r.left
    this._dockTop = r.top
    this._dockPinX = "none"
    this._dockPinY = "none"
    this._dockPositionReady = true
    this.applyDockPixelPosition()
  }

  /** After refresh: if the dock does not intersect the viewport, place it back inside the margins. */
  clampSpawnIfOffScreen() {
    if (!this.hasDockTarget || !this._dockPositionReady) return
    const iw = window.innerWidth
    const ih = window.innerHeight
    const dock = this.dockTarget
    const w = dock.offsetWidth
    const h = dock.offsetHeight
    if (w < 1 || h < 1) return
    const left = this._dockLeft
    const top = this._dockTop
    const intersects = left < iw && left + w > 0 && top < ih && top + h > 0
    if (intersects) return

    const m = getNexusDesktopShellInsetPx()
    const lx = this.crabLeftMinPx()
    this._dockLeft = Math.min(Math.max(lx, left), Math.max(m, iw - w - m))
    this._dockTop = Math.min(Math.max(m, top), Math.max(m, ih - h - m))
    this._dockPinX = "none"
    this._dockPinY = "none"
    this.applyDockPixelPosition()
    this.persistDockState()
  }

  finalizeDockAfterDrag() {
    this._dockPinX = "none"
    this._dockPinY = "none"
    this.reconcileDockOnResize()
  }

  onPetKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      this.toggle()
    }
  }

  scheduleBubblePlacement() {
    if (this._bubbleRaf) return
    this._bubbleRaf = requestAnimationFrame(() => {
      this._bubbleRaf = null
      this.updateBubblePlacement()
    })
  }

  updateBubblePlacement() {
    if (!this.hasDockTarget || !this.hasPetTarget || !this.hasPanelTarget) return

    const dock = this.dockTarget
    const pet = this.petTarget
    const panel = this.panelTarget
    const gap = 0
    /* Pull bubble toward the crab (~half prior slack). */
    const tuckPx = 16
    /* Former clip-path tail was 10px tall; shift anchor so the panel edge sits where the tip was. */
    const formerTailPx = 10

    const dr = dock.getBoundingClientRect()
    const anchor = this.hasMascotTarget ? this.mascotTarget.getBoundingClientRect() : pet.getBoundingClientRect()
    const petCx = anchor.left + anchor.width / 2

    const w = Math.max(panel.offsetWidth || 296, 200)
    const estH = Math.min(window.innerHeight * 0.52, 400)
    const spaceAbove = anchor.top
    const spaceBelow = window.innerHeight - anchor.bottom
    const needV = estH + gap + 24
    const preferBelow = spaceAbove < needV && spaceBelow > spaceAbove + 20

    let leftRelDock = petCx - dr.left - w * 0.5
    const maxLeft = window.innerWidth - 8 - w - dr.left
    const minLeft = 8 - dr.left
    leftRelDock = Math.min(maxLeft, Math.max(minLeft, leftRelDock))

    panel.style.left = `${leftRelDock}px`
    panel.style.right = "auto"
    panel.style.transform = "none"

    const baseStack = Math.max(0, pet.offsetHeight + gap - tuckPx)
    /* Lift bubble so it clears the mascot; pull down by former tail so bottom matches old tip. */
    const bubbleLiftPx = 14
    if (preferBelow) {
      panel.style.top = `${baseStack - formerTailPx}px`
      panel.style.bottom = "auto"
    } else {
      panel.style.bottom = `${baseStack + bubbleLiftPx - formerTailPx}px`
      panel.style.top = "auto"
    }
  }

  restoreState() {
    try {
      const raw = localStorage.getItem(STORAGE_POS)
      if (raw) {
        const o = JSON.parse(raw)
        if (typeof o.left === "number" && typeof o.top === "number") {
          this._dockLeft = o.left
          this._dockTop = o.top
          this._dockPinX = o.pinX === "left" || o.pinX === "right" ? o.pinX : "none"
          this._dockPinY = o.pinY === "top" || o.pinY === "bottom" ? o.pinY : "none"
          this._dockPositionReady = true
          this.applyDockPixelPosition()
        }
      }
      const open = localStorage.getItem(STORAGE_OPEN) === "1"
      if (open) this.open({ fromRestore: true })
      else this.close({ fromRestore: true })
      requestAnimationFrame(() => {
        this.bootstrapDockFromDomIfNeeded()
        this.clampSpawnIfOffScreen()
        this.reconcileDockOnResize()
        this.scheduleBubblePlacement()
        if (!this._dockPositionReady) {
          requestAnimationFrame(() => {
            this.bootstrapDockFromDomIfNeeded()
            this.clampSpawnIfOffScreen()
            this.reconcileDockOnResize()
            this.scheduleBubblePlacement()
          })
        }
      })
    } catch {
      this.close({ fromRestore: true })
    }
  }

  persistOpen(open) {
    try {
      localStorage.setItem(STORAGE_OPEN, open ? "1" : "0")
    } catch { /* ignore */ }
  }

  toggle() {
    this.bumpActivity()
    if (this.rootTarget.classList.contains("ollama-helper--open")) this.close()
    else this.open()
  }

  bringHelperToFront() {
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.rootTarget.style.zIndex = String(next)
    syncOrganizerAboveVisibleContentWindows()
  }

  onPanelPointerDown(event) {
    if (!this.rootTarget.classList.contains("ollama-helper--open")) return
    if (event.button !== undefined && event.button !== 0) return
    this.bringHelperToFront()
  }

  attachOutsideCloseListener() {
    window.addEventListener("pointerdown", this._onOutsidePointerDown, true)
  }

  detachOutsideCloseListener() {
    window.removeEventListener("pointerdown", this._onOutsidePointerDown, true)
  }

  handleOutsidePointerDown(event) {
    if (!this.rootTarget.classList.contains("ollama-helper--open")) return
    const t = event.target
    if (this.panelTarget.contains(t)) return
    if (this.petTarget.contains(t)) return
    this.close()
  }

  syncThreadVisibility() {
    if (!this.hasPanelTarget || !this.hasMessagesTarget) return
    const empty = this.messagesTarget.childElementCount === 0
    const loading = this.rootTarget.classList.contains("ollama-helper--loading")
    this.panelTarget.classList.toggle("ollama-helper--no-thread", empty && !loading)
  }

  open(opts = {}) {
    this.rootTarget.classList.add("ollama-helper--open")
    this.petTarget.setAttribute("aria-expanded", "true")
    this.persistOpen(true)
    this.bringHelperToFront()
    this.attachOutsideCloseListener()
    if (!opts.fromRestore) this.bumpActivity()
    requestAnimationFrame(() => {
      this.updateBubblePlacement()
      requestAnimationFrame(() => {
        this.updateBubblePlacement()
        this.resizeTextarea()
        this.syncThreadVisibility()
        this.inputTarget?.focus()
      })
    })
  }

  close(opts = {}) {
    this.detachOutsideCloseListener()
    this.rootTarget.classList.remove("ollama-helper--open")
    this.petTarget.setAttribute("aria-expanded", "false")
    this.persistOpen(false)
    window.clearTimeout(this._flashTimer)
    this._flashTimer = null
    window.clearTimeout(this._moodTimer)
    this._moodTimer = null
    if (!opts.fromRestore) this.bumpActivity()
    if (!this.rootTarget.classList.contains("ollama-helper--loading")) {
      this.setVisual("idle", { force: true })
    }
  }

  async submit(event) {
    event?.preventDefault()
    if (this.rootTarget.classList.contains("ollama-helper--loading")) return
    const text = (this.inputTarget.value || "").trim()
    if (!text) return

    this.inputTarget.value = ""
    this.resizeTextarea()
    window.clearTimeout(this._typingShowTimer)
    this._typingShowTimer = null
    window.clearTimeout(this._flashTimer)
    this._flashTimer = null

    this.appendBubble("user", text)
    this.history.push({ role: "user", content: text })
    this.bumpActivity()
    this.setVisual("thinking", { force: true })
    this.setLoading(true)
    this.clearStatus()

    let succeeded = false
    try {
      const token = document.querySelector('meta[name="csrf-token"]')?.content
      const res = await fetch(this.chatUrlValue, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": token || ""
        },
        body: JSON.stringify({ messages: this.history })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        const err = data.error || res.statusText || "Request failed"
        this.appendBubble("assistant", err, true)
        this.setVisual("error", { force: true })
        window.clearTimeout(this._moodTimer)
        this._moodTimer = window.setTimeout(() => {
          this._moodTimer = null
          this.setVisual("idle", { force: true })
          this.bumpActivity()
        }, 2600)
        return
      }
      const reply = data.content || ""
      this.history.push({ role: "assistant", content: reply })
      this.appendBubble("assistant", reply)
      succeeded = true
    } catch (e) {
      this.appendBubble("assistant", String(e.message || e), true)
      this.setVisual("error", { force: true })
      window.clearTimeout(this._moodTimer)
      this._moodTimer = window.setTimeout(() => {
        this._moodTimer = null
        this.setVisual("idle", { force: true })
        this.bumpActivity()
      }, 2600)
    } finally {
      this.setLoading(false)
      this.scrollMessages()
      this.scheduleBubblePlacement()
      if (succeeded) {
        this.setVisual("happy", { force: true })
        window.clearTimeout(this._moodTimer)
        this._moodTimer = window.setTimeout(() => {
          this._moodTimer = null
          this.setVisual("idle", { force: true })
          this.bumpActivity()
        }, 2100)
      }
    }
  }

  appendBubble(role, text, isError = false) {
    const row = document.createElement("div")
    row.className = `ollama-helper__msg-row ollama-helper__msg-row--${role}`
    const wrap = document.createElement("div")
    wrap.className = "ollama-helper__msg-bubble-wrap"
    const bubble = document.createElement("div")
    bubble.className = "ollama-helper__msg-bubble"
    if (isError) bubble.classList.add("ollama-helper__msg-bubble--error")
    bubble.textContent = text
    wrap.appendChild(bubble)
    row.appendChild(wrap)
    this.messagesTarget.appendChild(row)
    this.syncThreadVisibility()
    this.scrollMessages()
    this.scheduleBubblePlacement()
  }

  clearStatus() {
    if (this.hasStatusTarget) this.statusTarget.textContent = ""
  }

  setLoading(on) {
    this.rootTarget.classList.toggle("ollama-helper--loading", on)
    if (this.hasStatusTarget) this.statusTarget.textContent = on ? "Thinking…" : ""
    if (this.hasInputTarget) this.inputTarget.disabled = on
    this.syncThreadVisibility()
  }

  scrollMessages() {
    const el = this.messagesTarget
    el.scrollTop = el.scrollHeight
  }

  maybeSubmit(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      this.submit(event)
    }
  }
}
