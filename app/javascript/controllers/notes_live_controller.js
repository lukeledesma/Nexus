import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = {
    documentId: Number
  }

  connect() {
    this.boundRemoteDocumentChanged = this.handleRemoteDocumentChanged.bind(this)
    window.addEventListener("nexus:document-remote-changed", this.boundRemoteDocumentChanged)
  }

  disconnect() {
    window.removeEventListener("nexus:document-remote-changed", this.boundRemoteDocumentChanged)
  }

  handleRemoteDocumentChanged(event) {
    const detail = event?.detail || {}
    const incomingId = Number(detail.document_id)
    const linkedId = Number(this.documentIdValue)
    if (!Number.isInteger(incomingId) || incomingId <= 0) return
    if (!Number.isInteger(linkedId) || linkedId <= 0) return
    if (incomingId !== linkedId) return
    if (String(detail.content_type || "") !== "note") return

    // Never clobber active local typing.
    if (document.activeElement === this.element) return

    const incoming = String(detail.content || "")
    if (incoming === this.element.value) return
    this.element.value = incoming
  }
}
