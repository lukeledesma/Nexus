import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["backdrop", "window"]

  connect() {
    this.closeModalFromEvent = this.closeModalFromEvent.bind(this)
    this.element.addEventListener("organizer:closeModal", this.closeModalFromEvent)
  }

  disconnect() {
    this.element.removeEventListener("organizer:closeModal", this.closeModalFromEvent)
  }

  open(event) {
    const modalId = event.currentTarget.dataset.modalId
    const backdrop = this.#findBackdrop(modalId)
    if (!backdrop) return

    backdrop.classList.remove("hidden")
    requestAnimationFrame(() => backdrop.classList.add("is-open"))
  }

  close(event) {
    const backdrop = event.currentTarget.closest("[data-modal-id]")
    this.#hideBackdrop(backdrop)
  }

  backdropClose(event) {
    if (event.target !== event.currentTarget) return
    this.#hideBackdrop(event.currentTarget)
  }

  closeModalFromEvent(event) {
    const modalId = event.detail?.modalId
    const backdrop = this.#findBackdrop(modalId)
    this.#hideBackdrop(backdrop)
  }

  #findBackdrop(modalId) {
    if (!modalId) return null
    return this.element.querySelector(`[data-modal-id="${modalId}"]`)
  }

  #hideBackdrop(backdrop) {
    if (!backdrop) return
    backdrop.classList.remove("is-open")
    window.setTimeout(() => backdrop.classList.add("hidden"), 180)
  }
}
