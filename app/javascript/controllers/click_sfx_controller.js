import { Controller } from "@hotwired/stimulus"

const DOWN_SOUND_URL = "/sounds/Minimalist7.wav"
const UP_SOUND_URL = "/sounds/Minimalist8.wav"
const CLICK_SFX_GAIN = 0.0765
const CLICK_SFX_UP_GAIN = 0.0255
const CLICK_SFX_PLAYBACK_RATE = 0.7071

export default class extends Controller {
  connect() {
    this.activePointerId = null
    this.pressStarted = false
    this.audioContext = null
    this.downBuffer = null
    this.upBuffer = null
    this.preloadStarted = false
    this.audioUnlocked = false

    this.downTemplate = new Audio(DOWN_SOUND_URL)
    this.upTemplate = new Audio(UP_SOUND_URL)
    this.downTemplate.preload = "auto"
    this.upTemplate.preload = "auto"
    this.downTemplate.volume = CLICK_SFX_GAIN
    this.upTemplate.volume = CLICK_SFX_UP_GAIN

    this.preloadBuffers()

    this.boundPointerDown = this.handlePointerDown.bind(this)
    this.boundPointerUp = this.handlePointerUp.bind(this)
    this.boundPointerCancel = this.handlePointerCancel.bind(this)

    document.addEventListener("pointerdown", this.boundPointerDown, true)
    document.addEventListener("pointerup", this.boundPointerUp, true)
    document.addEventListener("pointercancel", this.boundPointerCancel, true)
  }

  disconnect() {
    document.removeEventListener("pointerdown", this.boundPointerDown, true)
    document.removeEventListener("pointerup", this.boundPointerUp, true)
    document.removeEventListener("pointercancel", this.boundPointerCancel, true)
  }

  handlePointerDown(event) {
    if (!this.isPrimaryPointer(event)) return

    this.pressStarted = true
    this.activePointerId = event.pointerId

    this.unlockAudio()
    this.playDown()
  }

  handlePointerUp(event) {
    if (!this.isPrimaryPointer(event)) return
    if (this.activePointerId !== event.pointerId) return

    const started = this.pressStarted
    this.activePointerId = null
    this.pressStarted = false
    if (!started) return

    this.playUp()
  }

  handlePointerCancel(event) {
    if (this.activePointerId !== event.pointerId) return
    this.activePointerId = null
    this.pressStarted = false
  }

  isPrimaryPointer(event) {
    if (!event) return false
    if (event.isPrimary === false) return false
    if (typeof event.button === "number" && event.button !== 0) return false
    return true
  }

  async preloadBuffers() {
    if (this.preloadStarted) return
    this.preloadStarted = true

    try {
      this.audioContext ||= new (window.AudioContext || window.webkitAudioContext)()
      const [downRes, upRes] = await Promise.all([fetch(DOWN_SOUND_URL), fetch(UP_SOUND_URL)])
      const [downData, upData] = await Promise.all([downRes.arrayBuffer(), upRes.arrayBuffer()])
      const [downBuffer, upBuffer] = await Promise.all([
        this.audioContext.decodeAudioData(downData.slice(0)),
        this.audioContext.decodeAudioData(upData.slice(0))
      ])
      this.downBuffer = downBuffer
      this.upBuffer = upBuffer
    } catch (_e) {
      // Fallback to HTMLAudio playback handled in playFallback.
    }
  }

  unlockAudio() {
    if (this.audioUnlocked) return
    this.audioUnlocked = true
    if (!this.audioContext) return
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume().catch(() => {})
    }
  }

  playDown() {
    this.playBuffer(this.downBuffer, CLICK_SFX_GAIN) || this.playFallback(this.downTemplate, CLICK_SFX_GAIN)
  }

  playUp() {
    this.playBuffer(this.upBuffer, CLICK_SFX_UP_GAIN) || this.playFallback(this.upTemplate, CLICK_SFX_UP_GAIN)
  }

  playBuffer(buffer, gainValue) {
    if (!this.audioContext || !buffer) return false
    try {
      const source = this.audioContext.createBufferSource()
      const gain = this.audioContext.createGain()
      gain.gain.value = gainValue
      source.playbackRate.value = CLICK_SFX_PLAYBACK_RATE
      source.buffer = buffer
      source.connect(gain)
      gain.connect(this.audioContext.destination)
      source.start(0)
      return true
    } catch (_e) {
      return false
    }
  }

  playFallback(templateAudio, gainValue) {
    if (!templateAudio) return
    try {
      templateAudio.volume = gainValue
      templateAudio.currentTime = 0
      templateAudio.playbackRate = CLICK_SFX_PLAYBACK_RATE
      templateAudio.defaultPlaybackRate = CLICK_SFX_PLAYBACK_RATE
      templateAudio.preservesPitch = false
      templateAudio.mozPreservesPitch = false
      templateAudio.webkitPreservesPitch = false
      void templateAudio.play().catch(() => {})
    } catch (_e) {
      // no-op
    }
  }
}
