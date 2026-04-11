import { Controller } from "@hotwired/stimulus"

const COLORS = [
  { bg: "#1a2035", fg: "#c8d8f8", accent: "hsl(220,60%,65%)", name: "navy" },
  { bg: "#1c2a1e", fg: "#c2f0cc", accent: "hsl(138,50%,60%)", name: "forest" },
  { bg: "#2a1e2a", fg: "#f0c8f0", accent: "hsl(290,50%,70%)", name: "plum" },
  { bg: "#2a1e14", fg: "#f5ddb8", accent: "hsl(38,65%,65%)", name: "amber" },
  { bg: "#1e2828", fg: "#b8f0ee", accent: "hsl(175,55%,62%)", name: "teal" },
  { bg: "#2a1a1a", fg: "#f5c0c4", accent: "hsl(358,60%,68%)", name: "rose" },
  { bg: "#221e2a", fg: "#d8cef5", accent: "hsl(250,55%,70%)", name: "violet" }
]

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4

export default class extends Controller {
  static targets = [
    "hint",
    "viewport",
    "gridCanvas",
    "world",
    "connSvg",
    "draftSvg",
    "draftPath",
    "minimap",
    "minimapCanvas",
    "minimapVp",
    "zoomLabel",
    "toolbar",
    "swatches",
    "ctxMenu",
    "ctxColors",
    "btnAdd",
    "btnDel",
    "btnGrid",
    "btnFit",
    "btnClear"
  ]

  static values = {
    initialDocument: { type: Object, default: {} },
    saveUrl: { type: String, default: "" }
  }

  connect() {
    this.abort = new AbortController()
    const s = this.abort.signal

    this.cards = []
    this.connections = []
    this.selectedCards = new Set()
    this.selectedConn = null
    this.activeColor = 0
    this.gridOn = true
    this._cardId = 0
    this._connId = 0
    this.hintGone = false
    this.panX = 0
    this.panY = 0
    this.zoom = 1
    this.mmTimer = null
    this.mmHideTimer = null
    this.saveTimer = null
    this.ctxTargetId = null

    this.boundResize = () => {
      this.drawGrid()
      this.scheduleMinimap()
    }

    this.applyViewFromDoc()
    this.buildSwatches()
    if (!this.hydrateFromServer()) {
      this.seedDemo()
    } else {
      this.applyTransform()
    }

    this.viewportTarget.addEventListener("wheel", (e) => this.onWheel(e), { passive: false, signal: s })
    this.viewportTarget.addEventListener("mousedown", (e) => this.onViewportDown(e), { signal: s })
    this.viewportTarget.addEventListener("dblclick", (e) => this.onViewportDblclick(e), { signal: s })
    document.addEventListener("keydown", (e) => this.onKeydown(e), { signal: s })
    document.addEventListener("click", () => this.hideCtx(), { signal: s })
    document.addEventListener("contextmenu", (e) => this.onDocCtxMenu(e), { signal: s })
    window.addEventListener("resize", this.boundResize, { signal: s })
    this.boundRequestSave = (e) => this.handleRequestSave(e)
    document.addEventListener("nexus:request-save", this.boundRequestSave)
  }

  disconnect() {
    document.removeEventListener("nexus:request-save", this.boundRequestSave)
    this.abort?.abort()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.mmHideTimer) clearTimeout(this.mmHideTimer)
  }

  handleRequestSave(event) {
    const frame = this.element.closest("turbo-frame")
    if (!frame || event.detail?.frameId !== frame.id) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.saveToServer()
  }

  applyViewFromDoc() {
    const v = this.initialDocumentValue?.view || {}
    if (typeof v.zoom === "number" && Number.isFinite(v.zoom)) {
      this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom))
    }
    if (typeof v.panX === "number" && Number.isFinite(v.panX)) this.panX = v.panX
    if (typeof v.panY === "number" && Number.isFinite(v.panY)) this.panY = v.panY
    if (typeof v.gridOn === "boolean") {
      this.gridOn = v.gridOn
      if (this.hasBtnGridTarget) this.btnGridTarget.classList.toggle("active", this.gridOn)
    }
    const nc = this.initialDocumentValue?.nextCardId ?? this.initialDocumentValue?.next_card_id
    const nk = this.initialDocumentValue?.nextConnId ?? this.initialDocumentValue?.next_conn_id
    if (typeof nc === "number" && nc > 0) this._cardId = nc
    if (typeof nk === "number" && nk > 0) this._connId = nk
  }

  hydrateFromServer() {
    const doc = this.initialDocumentValue || {}
    const rawCards = doc.cards
    if (!Array.isArray(rawCards) || rawCards.length === 0) return false

    rawCards.forEach((c) => {
      const id = parseInt(c.id, 10)
      const x = Number(c.x)
      const y = Number(c.y)
      const w = Number(c.w) || 210
      const h = Number(c.h) || 130
      const colorIdx = Number(c.colorIdx) || 0
      const text = c.text != null ? String(c.text) : ""
      if (!Number.isFinite(id) || !Number.isFinite(x) || !Number.isFinite(y)) return
      this._cardId = Math.max(this._cardId, id)
      this.createCardAt(x + w / 2, y + h / 2, text, colorIdx, w, h, id)
    })

    const rawConns = doc.connections
    if (Array.isArray(rawConns)) {
      rawConns.forEach((c) => {
        const id = parseInt(c.id, 10)
        const fromId = parseInt(c.fromId, 10)
        const toId = parseInt(c.toId, 10)
        const fromSide = c.fromSide || "right"
        const toSide = c.toSide || "left"
        if (!Number.isFinite(id) || !Number.isFinite(fromId) || !Number.isFinite(toId)) return
        if (!this.findCard(fromId) || !this.findCard(toId)) return
        this._connId = Math.max(this._connId, id)
        this.makeConnection(fromId, fromSide, toId, toSide, id)
      })
    }

    this.clearSel()
    return true
  }

  seedDemo() {
    requestAnimationFrame(() => {
      const vw = this.viewportTarget.offsetWidth
      const vh = this.viewportTarget.offsetHeight
      const cx = vw / 2
      const cy = vh / 2
      const a = this.createCard(this.s2w(cx - 170, cy - 55).x, this.s2w(cx - 170, cy - 55).y, "Double-click anywhere to add a card", 0)
      const b = this.createCard(this.s2w(cx + 130, cy - 80).x, this.s2w(cx + 130, cy - 80).y, "Drag the dots on card edges to connect cards", 1)
      const c = this.createCard(this.s2w(cx - 30, cy + 110).x, this.s2w(cx - 30, cy + 110).y, "Right-click a card to change its color or delete it", 4)
      requestAnimationFrame(() => {
        this.makeConnection(a.id, "right", b.id, "left")
        this.makeConnection(b.id, "bottom", c.id, "right")
        this.clearSel()
      })
      this.dimHint()
      this.applyTransform()
      this.scheduleSave()
    })
  }

  s2w(sx, sy) {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom }
  }

  w2s(wx, wy) {
    return { x: wx * this.zoom + this.panX, y: wy * this.zoom + this.panY }
  }

  clampZ(z) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
  }

  drawGrid() {
    const c = this.gridCanvasTarget
    const w = this.viewportTarget.offsetWidth
    const h = this.viewportTarget.offsetHeight
    c.width = w
    c.height = h
    const ctx = c.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    if (!this.gridOn) return

    const baseSpacing = 32
    const spacing = baseSpacing * this.zoom
    const offX = ((this.panX % spacing) + spacing) % spacing
    const offY = ((this.panY % spacing) + spacing) % spacing

    ctx.fillStyle = "rgba(160, 165, 200, 0.22)"
    for (let x = offX; x < w; x += spacing) {
      for (let y = offY; y < h; y += spacing) {
        ctx.beginPath()
        ctx.arc(x, y, 0.9, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  applyTransform() {
    this.worldTarget.style.transform = `translate(${this.panX}px,${this.panY}px) scale(${this.zoom})`
    if (this.hasZoomLabelTarget) this.zoomLabelTarget.textContent = `${Math.round(this.zoom * 100)}%`
    this.drawGrid()
    this.scheduleMinimap()
  }

  buildSwatches() {
    this.swatchesTarget.replaceChildren()
    this.ctxColorsTarget.replaceChildren()
    COLORS.forEach((c, i) => {
      this.swatchesTarget.appendChild(this.makeSwatch(c, i, () => this.pickColor(i)))
      this.ctxColorsTarget.appendChild(this.makeSwatch(c, i, () => {
        this.pickColor(i)
        this.hideCtx()
      }))
    })
    this.pickColor(this.activeColor)
  }

  makeSwatch(c, i, onClick) {
    const s = document.createElement("div")
    s.className = "thread-board-swatch"
    s.style.background = c.accent
    s.title = c.name
    s.addEventListener("click", (e) => {
      e.stopPropagation()
      onClick()
    })
    return s
  }

  pickColor(idx) {
    this.activeColor = idx
    this.swatchesTarget.querySelectorAll(".thread-board-swatch").forEach((s, i) => s.classList.toggle("active", i === idx))
    this.selectedCards.forEach((id) => {
      const card = this.findCard(id)
      if (card) this.applyColor(card, idx)
    })
    this.scheduleSave()
  }

  applyColor(card, idx) {
    const c = COLORS[idx]
    card.colorIdx = idx
    card.el.querySelector(".thread-board-card-inner").style.background = c.bg
    card.el.querySelector(".thread-board-card-text").style.color = c.fg
    card.el.querySelector(".thread-board-card-tag").style.color = c.fg
  }

  findCard(id) {
    return this.cards.find((c) => c.id === id)
  }

  createCard(wx, wy, text = "", colorIdx = this.activeColor, w = 210, h = 130) {
    const id = ++this._cardId
    return this.createCardAt(wx, wy, text, colorIdx, w, h, id)
  }

  createCardAt(wx, wy, text, colorIdx, w, h, id) {
    const c = COLORS[colorIdx] || COLORS[0]
    const el = document.createElement("div")
    el.className = "thread-board-card"
    el.dataset.id = String(id)
    el.style.cssText = `left:${wx - w / 2}px;top:${wy - h / 2}px;width:${w}px;height:${h}px;z-index:${id};`

    const inner = document.createElement("div")
    inner.className = "thread-board-card-inner"
    inner.style.background = c.bg

    const tag = document.createElement("div")
    tag.className = "thread-board-card-tag"
    tag.textContent = "thread"
    tag.style.color = c.fg

    const ta = document.createElement("textarea")
    ta.className = "thread-board-card-text"
    ta.placeholder = "Type something…"
    ta.value = text
    ta.style.color = c.fg
    ta.rows = 3
    ta.addEventListener("input", () => this.scheduleSave())
    ta.addEventListener("mousedown", (e) => e.stopPropagation())

    inner.appendChild(tag)
    inner.appendChild(ta)
    el.appendChild(inner)

    const rh = document.createElement("div")
    rh.className = "thread-board-card-resize"
    rh.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="rgba(255,255,255,0.5)"><path d="M10 0L0 10h2L10 2V0zM10 5L5 10h2l3-3V5zM10 8l-1 1h1V8z"/></svg>`
    rh.addEventListener("mousedown", (e) => this.onResizeDown(e, id))
    el.appendChild(rh)

    const anchorsEl = document.createElement("div")
    anchorsEl.className = "thread-board-card-anchors"
    ;["top", "right", "bottom", "left"].forEach((side) => {
      const a = document.createElement("div")
      a.className = `thread-board-anchor thread-board-anchor-${side}`
      a.dataset.side = side
      a.addEventListener("mousedown", (e) => {
        e.stopPropagation()
        this.startDraft(e, id, side)
      })
      anchorsEl.appendChild(a)
    })
    el.appendChild(anchorsEl)

    el.addEventListener("mousedown", (e) => this.onCardDown(e, id))
    el.addEventListener("contextmenu", (e) => this.showCtx(e, id))

    this.worldTarget.appendChild(el)

    const card = { id, x: wx - w / 2, y: wy - h / 2, w, h, colorIdx, el }
    this.cards.push(card)
    return card
  }

  onCardDown(e, id) {
    if (e.target.classList.contains("thread-board-anchor")) return
    if (e.target.classList.contains("thread-board-card-text")) return
    if (e.target.closest(".thread-board-card-resize")) return
    e.preventDefault()
    e.stopPropagation()

    if (!e.shiftKey && !this.selectedCards.has(id)) this.clearSel()
    this.addToSel(id)

    const card = this.findCard(id)
    card.el.style.zIndex = String(++this._cardId)

    const ox = e.clientX
    const oy = e.clientY
    const starts = new Map()
    this.selectedCards.forEach((sid) => {
      const sc = this.findCard(sid)
      if (sc) starts.set(sid, { x: sc.x, y: sc.y })
    })
    let moved = false

    const onMove = (ev) => {
      const dx = (ev.clientX - ox) / this.zoom
      const dy = (ev.clientY - oy) / this.zoom
      if (!moved && Math.hypot(dx, dy) > 2) {
        moved = true
        this.selectedCards.forEach((sid) => this.findCard(sid)?.el.classList.add("dragging"))
      }
      if (!moved) return
      starts.forEach((pos, sid) => {
        const sc = this.findCard(sid)
        if (!sc) return
        sc.x = pos.x + dx
        sc.y = pos.y + dy
        sc.el.style.left = `${sc.x}px`
        sc.el.style.top = `${sc.y}px`
      })
      this.updateAllConnections()
      this.scheduleMinimap()
    }

    const onUp = () => {
      this.selectedCards.forEach((sid) => this.findCard(sid)?.el.classList.remove("dragging"))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      if (moved) this.scheduleSave()
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  onResizeDown(e, id) {
    e.preventDefault()
    e.stopPropagation()
    const card = this.findCard(id)
    const ox = e.clientX
    const oy = e.clientY
    const sw = card.w
    const sh = card.h

    const onMove = (ev) => {
      card.w = Math.max(160, sw + (ev.clientX - ox) / this.zoom)
      card.h = Math.max(90, sh + (ev.clientY - oy) / this.zoom)
      card.el.style.width = `${card.w}px`
      card.el.style.height = `${card.h}px`
      this.updateAllConnections()
    }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      this.scheduleSave()
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  addToSel(id) {
    this.selectedCards.add(id)
    this.selectedConn = null
    this.syncSelUI()
  }

  clearSel() {
    this.selectedCards.clear()
    this.selectedConn = null
    this.syncSelUI()
  }

  syncSelUI() {
    this.cards.forEach((c) => c.el.classList.toggle("selected", this.selectedCards.has(c.id)))
    this.connSvgTarget.querySelectorAll(".thread-board-conn-path").forEach((p) =>
      p.classList.toggle("selected", p.dataset.id === String(this.selectedConn)))
  }

  anchorPos(card, side) {
    const w = card.el.offsetWidth
    const h = card.el.offsetHeight
    switch (side) {
      case "top":
        return { x: card.x + w / 2, y: card.y }
      case "bottom":
        return { x: card.x + w / 2, y: card.y + h }
      case "left":
        return { x: card.x, y: card.y + h / 2 }
      case "right":
        return { x: card.x + w, y: card.y + h / 2 }
      default:
        return { x: card.x, y: card.y }
    }
  }

  tangent(side, strength) {
    switch (side) {
      case "top":
        return { dx: 0, dy: -strength }
      case "bottom":
        return { dx: 0, dy: strength }
      case "left":
        return { dx: -strength, dy: 0 }
      case "right":
        return { dx: strength, dy: 0 }
      default:
        return { dx: 0, dy: 0 }
    }
  }

  bezier(x1, y1, x2, y2, s1, s2) {
    const dist = Math.hypot(x2 - x1, y2 - y1)
    const str = Math.min(dist * 0.45, 160)
    const t1 = this.tangent(s1, str)
    const t2 = this.tangent(s2, str)
    return `M${x1},${y1} C${x1 + t1.dx},${y1 + t1.dy} ${x2 + t2.dx},${y2 + t2.dy} ${x2},${y2}`
  }

  nearestSide(card, sx, sy) {
    const wp = this.s2w(sx, sy)
    const cx = card.x + card.el.offsetWidth / 2
    const cy = card.y + card.el.offsetHeight / 2
    const dx = wp.x - cx
    const dy = wp.y - cy
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top"
  }

  startDraft(e, fromId, fromSide) {
    const card = this.findCard(fromId)
    const ap = this.anchorPos(card, fromSide)
    const sp = this.w2s(ap.x, ap.y)

    const onMove = (ev) => {
      const x1 = sp.x
      const y1 = sp.y
      const x2 = ev.clientX
      const y2 = ev.clientY
      const dx = Math.abs(x2 - x1) * 0.45
      let path
      if (fromSide === "right" || fromSide === "left") {
        const sdx = fromSide === "right" ? dx : -dx
        path = `M${x1},${y1} C${x1 + sdx},${y1} ${x2 - sdx},${y2} ${x2},${y2}`
      } else {
        const sdy = fromSide === "bottom" ? dx : -dx
        path = `M${x1},${y1} C${x1},${y1 + sdy} ${x2},${y2 - sdy} ${x2},${y2}`
      }
      this.draftPathTarget.setAttribute("d", path)
    }

    const onUp = (ev) => {
      this.draftPathTarget.setAttribute("d", "")
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)

      const elHit = document.elementFromPoint(ev.clientX, ev.clientY)
      const cardEl = elHit?.closest(".thread-board-card")
      if (!cardEl) return
      const toId = parseInt(cardEl.dataset.id, 10)
      if (toId === fromId) return
      const dup = this.connections.find(
        (c) =>
          (c.fromId === fromId && c.toId === toId) || (c.fromId === toId && c.toId === fromId)
      )
      if (dup) return
      const toCard = this.findCard(toId)
      const toSide = this.nearestSide(toCard, ev.clientX, ev.clientY)
      this.makeConnection(fromId, fromSide, toId, toSide)
      this.scheduleSave()
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  makeConnection(fromId, fromSide, toId, toSide, existingId = null) {
    const id = existingId != null ? existingId : ++this._connId
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.classList.add("thread-board-conn-path")
    path.dataset.id = String(id)
    path.setAttribute("pointer-events", "stroke")
    path.addEventListener("click", (e) => {
      e.stopPropagation()
      this.clearSel()
      this.selectedConn = id
      this.syncSelUI()
    })
    this.connSvgTarget.appendChild(path)

    const conn = { id, fromId, fromSide, toId, toSide, el: path }
    this.connections.push(conn)
    this.updateConn(conn)
    this.scheduleMinimap()
    return conn
  }

  updateConn(conn) {
    const f = this.findCard(conn.fromId)
    const t = this.findCard(conn.toId)
    if (!f || !t) return
    const p1 = this.anchorPos(f, conn.fromSide)
    const p2 = this.anchorPos(t, conn.toSide)
    conn.el.setAttribute("d", this.bezier(p1.x, p1.y, p2.x, p2.y, conn.fromSide, conn.toSide))
  }

  updateAllConnections() {
    this.connections.forEach((c) => this.updateConn(c))
  }

  deleteSelected() {
    this.selectedCards.forEach((id) => {
      const card = this.findCard(id)
      if (!card) return
      card.el.remove()
      this.cards = this.cards.filter((c) => c.id !== id)
      this.connections = this.connections.filter((conn) => {
        if (conn.fromId === id || conn.toId === id) {
          conn.el.remove()
          return false
        }
        return true
      })
    })
    if (this.selectedConn !== null) {
      const idx = this.connections.findIndex((c) => c.id === this.selectedConn)
      if (idx >= 0) {
        this.connections[idx].el.remove()
        this.connections.splice(idx, 1)
      }
    }
    this.selectedCards.clear()
    this.selectedConn = null
    this.syncSelUI()
    this.scheduleMinimap()
    this.scheduleSave()
  }

  clearBoard() {
    if (!window.confirm("Clear the entire board?")) return
    this.cards.forEach((c) => c.el.remove())
    this.connections.forEach((c) => c.el.remove())
    this.cards = []
    this.connections = []
    this.selectedCards.clear()
    this.selectedConn = null
    this._cardId = 0
    this._connId = 0
    this.scheduleMinimap()
    this.scheduleSave()
  }

  onWheel(e) {
    e.preventDefault()
    const mx = e.clientX
    const my = e.clientY
    const factor = e.deltaMode === 1 ? 16 : 1
    const delta = -e.deltaY * factor * 0.001
    const nz = this.clampZ(this.zoom * Math.exp(delta * 2.8))
    this.panX = mx - (mx - this.panX) * (nz / this.zoom)
    this.panY = my - (my - this.panY) * (nz / this.zoom)
    this.zoom = nz
    this.applyTransform()
    this.scheduleSave()
  }

  onViewportDown(e) {
    const t = e.target
    if (t.closest(".thread-board-card")) return
    if (this.toolbarTarget.contains(t)) return
    if (this.ctxMenuTarget.contains(t)) return
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    this.clearSel()

    const ox = e.clientX
    const oy = e.clientY
    const spx = this.panX
    const spy = this.panY
    let moved = false

    const onMove = (ev) => {
      const dx = ev.clientX - ox
      const dy = ev.clientY - oy
      if (!moved && Math.hypot(dx, dy) > 3) {
        moved = true
        this.viewportTarget.style.cursor = "grabbing"
      }
      if (!moved) return
      this.panX = spx + dx
      this.panY = spy + dy
      this.applyTransform()
    }
    const onUp = () => {
      this.viewportTarget.style.cursor = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      if (moved) this.scheduleSave()
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  onViewportDblclick(e) {
    if (e.target.closest(".thread-board-card")) return
    e.preventDefault()
    const wp = this.s2w(e.clientX, e.clientY)
    const card = this.createCard(wp.x, wp.y)
    this.clearSel()
    this.addToSel(card.id)
    card.el.querySelector(".thread-board-card-text").focus()
    this.scheduleMinimap()
    this.dimHint()
    this.scheduleSave()
  }

  showCtx(e, id) {
    e.preventDefault()
    e.stopPropagation()
    this.ctxTargetId = id
    if (!this.selectedCards.has(id)) {
      this.clearSel()
      this.addToSel(id)
    }
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 140)
    this.ctxMenuTarget.style.left = `${x}px`
    this.ctxMenuTarget.style.top = `${y}px`
    this.ctxMenuTarget.hidden = false
  }

  hideCtx() {
    this.ctxMenuTarget.hidden = true
    this.ctxTargetId = null
  }

  ctxDelete() {
    this.hideCtx()
    this.deleteSelected()
  }

  onDocCtxMenu(e) {
    if (!e.target.closest(".thread-board-ctx-menu") && !e.target.closest(".thread-board-card")) this.hideCtx()
  }

  onKeydown(e) {
    if (e.target.tagName === "TEXTAREA") return
    if (e.key === "Delete" || e.key === "Backspace") this.deleteSelected()
    if (e.key === "Escape") this.clearSel()
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault()
      this.cards.forEach((c) => this.selectedCards.add(c.id))
      this.syncSelUI()
    }
  }

  addCardCenter() {
    const wp = this.s2w(this.viewportTarget.offsetWidth / 2, this.viewportTarget.offsetHeight / 2)
    const card = this.createCard(wp.x + (Math.random() - 0.5) * 80, wp.y + (Math.random() - 0.5) * 80)
    this.clearSel()
    this.addToSel(card.id)
    card.el.querySelector(".thread-board-card-text").focus()
    this.scheduleMinimap()
    this.scheduleSave()
  }

  toggleGrid() {
    this.gridOn = !this.gridOn
    this.btnGridTarget.classList.toggle("active", this.gridOn)
    this.drawGrid()
    this.scheduleSave()
  }

  fitAll() {
    if (this.cards.length === 0) return
    const pad = 80
    const vw = this.viewportTarget.offsetWidth
    const vh = this.viewportTarget.offsetHeight
    const allX = this.cards.map((c) => c.x)
    const allY = this.cards.map((c) => c.y)
    const allX2 = this.cards.map((c) => c.x + c.el.offsetWidth)
    const allY2 = this.cards.map((c) => c.y + c.el.offsetHeight)
    const minX = Math.min(...allX)
    const minY = Math.min(...allY)
    const maxX = Math.max(...allX2)
    const maxY = Math.max(...allY2)
    const scaleX = (vw - pad * 2) / (maxX - minX || 1)
    const scaleY = (vh - pad * 2) / (maxY - minY || 1)
    this.zoom = this.clampZ(Math.min(scaleX, scaleY, 2))
    this.panX = (vw - (maxX - minX) * this.zoom) / 2 - minX * this.zoom
    this.panY = (vh - (maxY - minY) * this.zoom) / 2 - minY * this.zoom
    this.applyTransform()
    this.scheduleSave()
  }

  scheduleMinimap() {
    if (this.mmTimer) cancelAnimationFrame(this.mmTimer)
    this.mmTimer = requestAnimationFrame(() => this.drawMinimap())
  }

  drawMinimap() {
    if (this.cards.length === 0) {
      this.minimapTarget.classList.remove("thread-board-minimap--show")
      return
    }

    this.minimapTarget.classList.add("thread-board-minimap--show")
    if (this.mmHideTimer) clearTimeout(this.mmHideTimer)
    this.mmHideTimer = setTimeout(() => this.minimapTarget.classList.remove("thread-board-minimap--show"), 2200)

    const dpr = window.devicePixelRatio || 1
    const mw = this.minimapTarget.offsetWidth
    const mh = this.minimapTarget.offsetHeight
    const canvas = this.minimapCanvasTarget
    canvas.width = mw * dpr
    canvas.height = mh * dpr
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, mw, mh)

    const xs = this.cards.map((c) => c.x)
    const ys = this.cards.map((c) => c.y)
    const x2s = this.cards.map((c) => c.x + c.el.offsetWidth)
    const y2s = this.cards.map((c) => c.y + c.el.offsetHeight)
    const mn = { x: Math.min(...xs) - 30, y: Math.min(...ys) - 30 }
    const mx2 = { x: Math.max(...x2s) + 30, y: Math.max(...y2s) + 30 }
    const rw = mx2.x - mn.x
    const rh = mx2.y - mn.y
    const sc = Math.min(mw / rw, mh / rh) * 0.92
    const ox = (mw - rw * sc) / 2
    const oy = (mh - rh * sc) / 2

    ctx.strokeStyle = "rgba(140,155,200,0.3)"
    ctx.lineWidth = 1
    this.connections.forEach((conn) => {
      const f = this.findCard(conn.fromId)
      const t = this.findCard(conn.toId)
      if (!f || !t) return
      const p1 = this.anchorPos(f, conn.fromSide)
      const p2 = this.anchorPos(t, conn.toSide)
      ctx.beginPath()
      ctx.moveTo(ox + (p1.x - mn.x) * sc, oy + (p1.y - mn.y) * sc)
      ctx.lineTo(ox + (p2.x - mn.x) * sc, oy + (p2.y - mn.y) * sc)
      ctx.stroke()
    })

    this.cards.forEach((c) => {
      const x = ox + (c.x - mn.x) * sc
      const y = oy + (c.y - mn.y) * sc
      const w = c.el.offsetWidth * sc
      const h = c.el.offsetHeight * sc
      ctx.fillStyle = COLORS[c.colorIdx].bg
      ctx.strokeStyle = COLORS[c.colorIdx].accent
      ctx.lineWidth = 0.8
      ctx.beginPath()
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 2)
      else ctx.rect(x, y, w, h)
      ctx.fill()
      ctx.stroke()
    })

    const vpW = this.viewportTarget.offsetWidth
    const vpH = this.viewportTarget.offsetHeight
    const vx = ox + (-this.panX / this.zoom - mn.x) * sc
    const vy = oy + (-this.panY / this.zoom - mn.y) * sc
    const vw = (vpW / this.zoom) * sc
    const vh = (vpH / this.zoom) * sc
    this.minimapVpTarget.style.left = `${vx}px`
    this.minimapVpTarget.style.top = `${vy}px`
    this.minimapVpTarget.style.width = `${vw}px`
    this.minimapVpTarget.style.height = `${vh}px`
  }

  dimHint() {
    if (this.hintGone) return
    this.hintGone = true
    if (!this.hasHintTarget) return
    this.hintTarget.style.opacity = "0"
    setTimeout(() => this.hintTarget.remove(), 700)
  }

  serialize() {
    return {
      cards: this.cards.map((c) => ({
        id: c.id,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        colorIdx: c.colorIdx,
        text: c.el.querySelector(".thread-board-card-text")?.value || ""
      })),
      connections: this.connections.map((c) => ({
        id: c.id,
        fromId: c.fromId,
        fromSide: c.fromSide,
        toId: c.toId,
        toSide: c.toSide
      })),
      view: {
        panX: this.panX,
        panY: this.panY,
        zoom: this.zoom,
        gridOn: this.gridOn
      },
      nextCardId: this._cardId,
      nextConnId: this._connId
    }
  }

  scheduleSave() {
    if (!this.hasSaveUrlValue || !this.saveUrlValue) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveToServer(), 600)
  }

  saveToServer() {
    if (!this.hasSaveUrlValue || !this.saveUrlValue) return Promise.resolve()
    const frame = this.element.closest("turbo-frame")
    const payload = this.serialize()
    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    return fetch(this.saveUrlValue, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify({ thread_board: JSON.stringify(payload) })
    })
      .then(async (res) => {
        if (!res.ok) return
        const json = await res.json().catch(() => ({}))
        const ts = (json.updated_at || "").toString().trim() || new Date().toISOString()
        const frameId = frame?.id
        window.dispatchEvent(
          new CustomEvent("nexus:singular-disk-saved", {
            detail: {
              itemType: json.item_type || "thread_board",
              timestamp: ts,
              frameId
            }
          })
        )
        document.dispatchEvent(
          new CustomEvent("nexus:thread-board-save-complete", {
            bubbles: true,
            detail: { frameId }
          })
        )
      })
      .catch(() => {})
  }
}
