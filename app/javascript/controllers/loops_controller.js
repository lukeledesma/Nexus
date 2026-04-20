import { Controller } from "@hotwired/stimulus"
import { materialSymbolSvg } from "lib/material_symbols"

const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"])

function displayAudioTitle(name) {
  const s = String(name || "").trim()
  if (!s) return "Untitled"
  return s.replace(/\.(mp3|wav|m4a|flac|ogg|aiff?|aif)\b/gi, "").trim() || "Untitled"
}

function formatSeconds(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return "00:00"
  const total = Math.floor(n)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

export default class extends Controller {
  static targets = ["audio", "waveform", "fileName", "timeCurrent", "timeRemaining", "playPauseButton"]

  connect() {
    this.objectUrl = null
    this.peaks = []
    this.rafId = null
    this.audioCtx = null
    this.pointerMode = null

    this.boundFrameLoad = this.handleFrameLoad.bind(this)
    this.boundResize = this.handleResize.bind(this)
    this.boundAudioUpdate = this.handleAudioUpdate.bind(this)
    this.boundAudioPlay = this.handleAudioPlay.bind(this)
    this.boundAudioPause = this.handleAudioPause.bind(this)
    this.boundAudioMetadata = this.handleAudioMetadata.bind(this)
    this.boundAudioEnded = this.handleAudioEnded.bind(this)
    this.boundAudioError = this.handleAudioError.bind(this)
    this.boundWindowBlur = this.stopRaf.bind(this)
    this.boundVisibility = this.handleVisibilityChange.bind(this)
    this.boundWorkspaceChromeSynced = this.handleWorkspaceChromeSynced.bind(this)
    this.boundWavePointerMove = this.wavePointerMove.bind(this)
    this.boundWavePointerUp = this.wavePointerUp.bind(this)
    this.boundWaveWheel = this.waveWheel.bind(this)

    this.audioElement = null
    this.waveformElement = null
    this.waveformWheelCleanup = null
    this._initialLinkedPayloadKey = null

    this.element.addEventListener("turbo:frame-load", this.boundFrameLoad)
    window.addEventListener("resize", this.boundResize)
    window.addEventListener("blur", this.boundWindowBlur)
    window.addEventListener("nexus:workspace-chrome-synced", this.boundWorkspaceChromeSynced)
    document.addEventListener("visibilitychange", this.boundVisibility)

    requestAnimationFrame(() => {
      this.hydrateTargets()
      this.tryLoadInitialLinkedDocument()
    })
  }

  disconnect() {
    this.element.removeEventListener("turbo:frame-load", this.boundFrameLoad)
    window.removeEventListener("resize", this.boundResize)
    window.removeEventListener("blur", this.boundWindowBlur)
    window.removeEventListener("nexus:workspace-chrome-synced", this.boundWorkspaceChromeSynced)
    document.removeEventListener("visibilitychange", this.boundVisibility)
    this.detachWavePointerListeners()
    this.detachWaveformWheel()
    this.detachAudioListeners()
    this.stopRaf()
    this.revokeObjectUrl()
    this.syncChromeTitle("")
    this._initialLinkedPayloadKey = null
  }

  syncChromeTitle(title) {
    const cw = this.application.getControllerForElementAndIdentifier(this.element, "content-window")
    cw?.syncOpenFileBadge?.((title || "").trim())
  }

  handleFrameLoad(event) {
    const t = event.target
    if (!(t instanceof HTMLElement) || t.tagName !== "TURBO-FRAME" || t.id !== "loops-pane") return
    this.revokeObjectUrl({ resetMeta: false })
    this._initialLinkedPayloadKey = null
    this.hydrateTargets()
    this.tryLoadInitialLinkedDocument()
  }

  hydrateTargets() {
    if (!this.hasAudioTarget || !this.hasWaveformTarget) return

    if (this.audioElement !== this.audioTarget) {
      this.detachAudioListeners()
      this.audioElement = this.audioTarget
      this.attachAudioListeners()
      this.audioElement.loop = true
    }

    if (this.waveformElement !== this.waveformTarget) {
      this.detachWaveformWheel()
      this.waveformElement = this.waveformTarget
      this.waveformElement.addEventListener("wheel", this.boundWaveWheel, { passive: false })
      this.waveformWheelCleanup = () => {
        this.waveformElement?.removeEventListener("wheel", this.boundWaveWheel, { passive: false })
        this.waveformWheelCleanup = null
      }
    }

    this.syncCanvasSize()
    this.syncPlayPauseIcon()
    this.drawWaveform()
  }

  attachAudioListeners() {
    if (!this.audioElement) return
    this.audioElement.addEventListener("timeupdate", this.boundAudioUpdate)
    this.audioElement.addEventListener("play", this.boundAudioPlay)
    this.audioElement.addEventListener("pause", this.boundAudioPause)
    this.audioElement.addEventListener("loadedmetadata", this.boundAudioMetadata)
    this.audioElement.addEventListener("ended", this.boundAudioEnded)
    this.audioElement.addEventListener("error", this.boundAudioError)
  }

  detachWaveformWheel() {
    if (typeof this.waveformWheelCleanup === "function") {
      this.waveformWheelCleanup()
    }
  }

  detachAudioListeners() {
    if (!this.audioElement) return
    this.audioElement.removeEventListener("timeupdate", this.boundAudioUpdate)
    this.audioElement.removeEventListener("play", this.boundAudioPlay)
    this.audioElement.removeEventListener("pause", this.boundAudioPause)
    this.audioElement.removeEventListener("loadedmetadata", this.boundAudioMetadata)
    this.audioElement.removeEventListener("ended", this.boundAudioEnded)
    this.audioElement.removeEventListener("error", this.boundAudioError)
    this.audioElement = null
  }

  dragEnter(event) {
    event.preventDefault()
    event.currentTarget?.classList?.add("loops-app--drop-target")
  }

  dragLeave(event) {
    const el = event.currentTarget
    if (el && event.relatedTarget && el.contains(event.relatedTarget)) return
    el?.classList?.remove("loops-app--drop-target")
  }

  dragOver(event) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
  }

  async handleDrop(event) {
    event.preventDefault()
    event.stopPropagation()
    this._clearDropTargetClass()

    const dt = event.dataTransfer
    if (!dt) return

    const fromFiles = this.audioFilesFromDataTransfer(dt)
    if (fromFiles.length > 0) {
      await this.loadFile(fromFiles[0])
      return
    }

    const url = this.assetUrlFromDataTransfer(dt)
    if (url) {
      await this.loadFromAssetUrl(url, {})
      return
    }

    const docId = this.documentIdFromDataTransfer(dt)
    if (docId) await this.loadFromAssetUrl(`/documents/${encodeURIComponent(docId)}/asset_file`, {})
  }

  _clearDropTargetClass() {
    const el = this.element.querySelector(".loops-app")
    el?.classList.remove("loops-app--drop-target")
  }

  audioFilesFromDataTransfer(dt) {
    const files = dt.files
    if (!files?.length) return []
    const out = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (this.validAudioFile(f)) out.push(f)
    }
    return out
  }

  /**
   * Load Finder-linked asset once per frame payload. Must NOT run from hydrateTargets()
   * because loadFile() calls hydrateTargets() and would re-enter forever.
   */
  tryLoadInitialLinkedDocument() {
    const app = this.element.querySelector(".loops-app")
    const id = app?.dataset?.loopsInitialDocumentId || ""
    if (!id) return
    const title = app?.dataset?.loopsInitialDocumentTitle || ""
    const key = `${id}\t${title}`
    if (this._initialLinkedPayloadKey === key) return
    this._initialLinkedPayloadKey = key
    void this.loadFromAssetUrl(`/documents/${encodeURIComponent(id)}/asset_file`, { displayTitle: title })
  }

  documentIdFromDataTransfer(dt) {
    const plain = dt.getData("text/plain")?.trim() || ""
    if (!/^\d+$/.test(plain)) return null
    return plain
  }

  assetUrlFromDataTransfer(dt) {
    const uriList = dt.getData("text/uri-list") || ""
    for (const raw of uriList.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith("#")) continue
      if (/\/documents\/\d+\/asset_file/.test(line)) {
        try {
          const u = new URL(line, window.location.origin)
          return u.pathname + u.search
        } catch (_e) {
          return null
        }
      }
    }
    return null
  }

  validAudioFile(file) {
    const mime = String(file.type || "").toLowerCase()
    const name = String(file.name || "").toLowerCase()
    if (AUDIO_MIME_TYPES.has(mime)) return true
    return /\.(mp3|wav|m4a|flac|ogg|aif|aiff)\b/i.test(name)
  }

  inferAudioFileName(blob, pathWithQuery, displayTitle) {
    const ct = (blob.type || "").toLowerCase()
    const p = pathWithQuery.toLowerCase()
    const ext = ct.includes("wav") || p.endsWith(".wav") ? ".wav" : ".mp3"
    const stem = (displayTitle || "Audio").replace(/\.(mp3|wav)\s*$/i, "").trim() || "Audio"
    return `${stem}${ext}`
  }

  async loadFromAssetUrl(pathWithQuery, options = {}) {
    try {
      const response = await fetch(pathWithQuery, { credentials: "same-origin" })
      if (!response.ok) return
      const blob = await response.blob()
      const ct = (blob.type || "").toLowerCase()
      const okType =
        AUDIO_MIME_TYPES.has(ct) || ct === "" || ct === "application/octet-stream" || ct.startsWith("audio/")
      const p = pathWithQuery.toLowerCase()
      if (!okType && !p.includes(".mp3") && !p.includes(".wav")) return

      const displayTitle = (options.displayTitle || "").trim()
      const fileName = this.inferAudioFileName(blob, pathWithQuery, displayTitle)
      const mimeType = fileName.endsWith(".wav") ? "audio/wav" : "audio/mpeg"
      const file = new File([blob], fileName, { type: mimeType })
      await this.loadFile(file, displayTitle ? { chromeTitle: displayTitle } : {})
    } catch (_error) {
      /* ignore */
    }
  }

  async loadFile(file, fileOptions = {}) {
    this.hydrateTargets()
    if (!this.audioElement) return

    this.stopPlaybackState()
    this.revokeObjectUrl({ resetMeta: false })

    const rawName = file.name || "audio.mp3"
    const chromeT = fileOptions.chromeTitle
    const label =
      chromeT != null && String(chromeT).trim() !== "" ? displayAudioTitle(chromeT) : displayAudioTitle(rawName)
    this.objectUrl = URL.createObjectURL(file)
    this.audioElement.src = this.objectUrl
    this.audioElement.loop = true
    this.audioElement.load()

    if (this.hasFileNameTarget) this.fileNameTarget.textContent = label
    this.syncChromeTitle(label)
    this.peaks = []
    this.syncPlayPauseIcon()
    this.updateTransportUi()
    this.drawWaveform()

    await this.decodeWaveform(file)
    this.drawWaveform()
  }

  async decodeWaveform(file) {
    if (!this.waveformElement) return
    try {
      this.audioCtx ||= new window.AudioContext()
      const buf = await file.arrayBuffer()
      const decoded = await this.audioCtx.decodeAudioData(buf.slice(0))
      this.peaks = this.buildPeaks(decoded, this.waveformElement.width || 320)
    } catch (_error) {
      this.peaks = []
    }
  }

  buildPeaks(audioBuffer, width) {
    const channelData = audioBuffer.getChannelData(0)
    const samples = Math.max(16, Math.floor(width))
    const block = Math.max(1, Math.floor(channelData.length / samples))
    const out = new Array(samples)

    for (let i = 0; i < samples; i++) {
      let max = 0
      const start = i * block
      const end = Math.min(channelData.length, start + block)
      for (let j = start; j < end; j++) {
        const v = Math.abs(channelData[j])
        if (v > max) max = v
      }
      out[i] = max
    }
    return out
  }

  durationSafe() {
    const d = this.audioElement?.duration
    return Number.isFinite(d) && d > 0 ? d : 0
  }

  async togglePlayback(event) {
    if (event) event.preventDefault()
    this.hydrateTargets()
    if (!this.audioElement?.src) return

    if (this.audioElement.paused) {
      try {
        await this.audioElement.play()
      } catch (_error) {
        window.alert("Playback could not start.")
      }
    } else {
      this.audioElement.pause()
    }
    this.syncPlayPauseIcon()
  }

  stopPlaybackState() {
    this.hydrateTargets()
    if (!this.audioElement) return
    this.audioElement.pause()
    this.audioElement.currentTime = 0
    this.syncPlayPauseIcon()
    this.stopRaf()
    this.drawWaveform()
  }

  handleAudioUpdate() {
    this.updateTransportUi()
    this.scheduleWaveformDraw()
  }

  handleAudioPlay() {
    this.syncPlayPauseIcon()
    this.scheduleWaveformDraw()
  }

  handleAudioPause() {
    this.syncPlayPauseIcon()
    this.stopRaf()
    this.drawWaveform()
  }

  handleAudioMetadata() {
    this.updateTransportUi()
    this.drawWaveform()
  }

  handleAudioEnded() {
    this.syncPlayPauseIcon()
    this.drawWaveform()
  }

  handleAudioError() {
    this.stopRaf()
    if (this.hasTimeCurrentTarget) this.timeCurrentTarget.textContent = "Error"
    this.syncChromeTitle("")
  }

  handleResize() {
    this.syncCanvasSize()
    this.drawWaveform()
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.stopRaf()
      return
    }
    if (this.audioElement && !this.audioElement.paused) this.scheduleWaveformDraw()
  }

  handleWorkspaceChromeSynced() {
    this.drawWaveform()
  }

  syncPlayPauseIcon() {
    if (!this.hasPlayPauseButtonTarget) return
    const playing = this.audioElement && !this.audioElement.paused
    this.playPauseButtonTarget.innerHTML = materialSymbolSvg(playing ? "pause" : "play_arrow", "xs")
    this.playPauseButtonTarget.setAttribute("aria-label", playing ? "Pause" : "Play")
    this.playPauseButtonTarget.setAttribute("title", playing ? "Pause" : "Play")
  }

  syncCanvasSize() {
    if (!this.waveformElement) return
    const rect = this.waveformElement.getBoundingClientRect()
    const width = Math.max(140, Math.round(rect.width))
    const height = Math.max(56, Math.round(rect.height || 72))
    if (this.waveformElement.width === width && this.waveformElement.height === height) return
    this.waveformElement.width = width
    this.waveformElement.height = height
    if (this.peaks.length > 0) {
      this.peaks = this.resamplePeaks(this.peaks, width)
    }
  }

  resamplePeaks(source, targetLen) {
    if (!Array.isArray(source) || source.length === 0) return []
    if (source.length === targetLen) return source
    const out = new Array(targetLen)
    const scale = (source.length - 1) / Math.max(1, targetLen - 1)
    for (let i = 0; i < targetLen; i++) {
      const idx = i * scale
      const lo = Math.floor(idx)
      const hi = Math.min(source.length - 1, lo + 1)
      const t = idx - lo
      out[i] = source[lo] * (1 - t) + source[hi] * t
    }
    return out
  }

  scheduleWaveformDraw() {
    this.stopRaf()
    const tick = () => {
      this.drawWaveform()
      if (this.audioElement && !this.audioElement.paused) {
        this.rafId = requestAnimationFrame(tick)
      } else {
        this.rafId = null
      }
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stopRaf() {
    if (!this.rafId) return
    cancelAnimationFrame(this.rafId)
    this.rafId = null
  }

  updateTransportUi() {
    if (!this.audioElement) return
    const current = this.audioElement.currentTime || 0
    const duration = this.durationSafe()
    const remaining = duration > 0 ? duration - current : 0
    if (this.hasTimeCurrentTarget) {
      this.timeCurrentTarget.textContent = formatSeconds(current)
    }
    if (this.hasTimeRemainingTarget) {
      this.timeRemainingTarget.textContent = duration > 0 ? `-${formatSeconds(remaining)}` : `-00:00`
    }
  }

  canvasLocalX(event) {
    const canvas = this.waveformElement
    if (!canvas) return 0
    const rect = canvas.getBoundingClientRect()
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
    return Math.max(0, Math.min(canvas.width, ratio * canvas.width))
  }

  timeFromCanvasX(x) {
    const d = this.durationSafe()
    if (d <= 0 || !this.waveformElement) return 0
    return (x / this.waveformElement.width) * d
  }

  waveWheel(event) {
    if (!this.audioElement?.src || !this.waveformElement) return
    const d = this.durationSafe()
    if (d <= 0) return

    let delta = 0
    if (event.deltaX) delta = event.deltaX
    else if (event.shiftKey && event.deltaY) delta = event.deltaY
    else if (event.deltaY) delta = event.deltaY
    else return

    event.preventDefault()
    const scale = d / Math.max(1, this.waveformElement.width)
    const step = delta * scale * 0.35
    const next = this.audioElement.currentTime + step
    this.audioElement.currentTime = Math.max(0, Math.min(d, next))
    this.updateTransportUi()
    this.drawWaveform()
  }

  wavePointerDown(event) {
    if (!this.waveformElement) return
    const d = this.durationSafe()
    if (d <= 0) return

    event.preventDefault()
    this.pointerMode = "scrub"
    const t = this.timeFromCanvasX(this.canvasLocalX(event))
    this.audioElement.currentTime = Math.max(0, Math.min(d, t))

    this.waveformElement.setPointerCapture(event.pointerId)
    this.waveformElement.addEventListener("pointermove", this.boundWavePointerMove)
    this.waveformElement.addEventListener("pointerup", this.boundWavePointerUp)
    this.waveformElement.addEventListener("pointercancel", this.boundWavePointerUp)
    this.updateTransportUi()
    this.drawWaveform()
  }

  wavePointerMove(event) {
    if (this.pointerMode !== "scrub" || !this.audioElement || !this.waveformElement) return
    const d = this.durationSafe()
    if (d <= 0) return

    const t = this.timeFromCanvasX(this.canvasLocalX(event))
    this.audioElement.currentTime = Math.max(0, Math.min(d, t))
    this.updateTransportUi()
    this.drawWaveform()
  }

  wavePointerUp(event) {
    this.detachWavePointerListeners(event)
    this.pointerMode = null
    this.drawWaveform()
  }

  detachWavePointerListeners(event) {
    if (!this.waveformElement) return
    this.waveformElement.removeEventListener("pointermove", this.boundWavePointerMove)
    this.waveformElement.removeEventListener("pointerup", this.boundWavePointerUp)
    this.waveformElement.removeEventListener("pointercancel", this.boundWavePointerUp)
    if (event?.pointerId != null && this.waveformElement.hasPointerCapture?.(event.pointerId)) {
      try {
        this.waveformElement.releasePointerCapture(event.pointerId)
      } catch (_e) {
        /* ignore */
      }
    }
  }

  drawWaveform() {
    if (!this.waveformElement) return
    const canvas = this.waveformElement
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    const style = getComputedStyle(canvas)
    const barBg = style.getPropertyValue("--loops-bar-bg").trim() || "rgba(255,255,255,0.04)"
    const barIdle = style.getPropertyValue("--loops-bar-idle").trim() || "rgba(227,227,227,0.42)"
    const barPlayed = style.getPropertyValue("--loops-bar-played").trim() || "rgba(130,214,255,0.88)"
    const barHead = style.getPropertyValue("--loops-bar-head").trim() || "rgba(255,255,255,0.55)"
    ctx.fillStyle = barBg
    ctx.fillRect(0, 0, w, h)

    const d = this.durationSafe()
    const mid = Math.floor(h / 2)
    const progress = d > 0 && this.audioElement ? Math.max(0, Math.min(1, this.audioElement.currentTime / d)) : 0
    const playedX = Math.floor(progress * w)

    const peaks = this.peaks.length > 0 ? this.peaks : new Array(Math.max(32, Math.floor(w / 2))).fill(0.24)
    const bars = peaks.length
    const barW = Math.max(1, w / bars)

    for (let i = 0; i < bars; i++) {
      const amp = Math.max(0.05, Math.min(1, peaks[i] || 0))
      const bh = Math.max(4, Math.floor(amp * (h * 0.78)))
      const x = Math.floor(i * barW)
      const y = Math.floor(mid - bh / 2)
      const fill = x <= playedX ? barPlayed : barIdle
      ctx.fillStyle = fill
      ctx.fillRect(x, y, Math.max(1, Math.floor(barW * 0.72)), bh)
    }

    ctx.fillStyle = barHead
    ctx.fillRect(playedX, 0, 1, h)

    canvas.style.cursor = this.pointerMode === "scrub" ? "grabbing" : "grab"
  }

  revokeObjectUrl(options = {}) {
    const resetMeta = options.resetMeta !== false
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    if (!resetMeta) return
    if (this.hasFileNameTarget) this.fileNameTarget.textContent = "Drop an MP3 or WAV here"
    this.syncChromeTitle("")
    this._initialLinkedPayloadKey = null
  }
}

