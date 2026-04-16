import { Controller } from "@hotwired/stimulus"

/**
 * Tracks “not saved to a Finder file yet” for Tasks when no linked document.
 * Linked files rely on autosave (item + document); switching files is safe without a prompt.
 */
export default class extends Controller {
  connect() {
    /* Always the OS shell document — bare `document` inside callbacks invoked from the save-picker iframe would wrongly use the iframe’s document. */
    this.doc = this.element.ownerDocument || document
    this.markDirty = this.markDirty.bind(this)
    this.clearAfterFinderSave = this.clearAfterFinderSave.bind(this)
    this.resetAfterFrameLoad = this.resetAfterFrameLoad.bind(this)
    window.nexusWorkspaceUnsaved = false
    window.nexusWorkspaceHasSubstantiveContent = () => this.#hasSubstantiveContent()
    window.nexusWorkspaceSubstantiveForFrameId = (frameId) => this.#substantiveContentForFrameId(frameId)

    this.doc.addEventListener("input", this.markDirty, true)
    this.doc.addEventListener("change", this.markDirty, true)
    window.addEventListener("nexus:singular-disk-saved", this.clearAfterFinderSave)
    this.doc.addEventListener("turbo:frame-load", this.resetAfterFrameLoad)
  }

  disconnect() {
    this.doc.removeEventListener("input", this.markDirty, true)
    this.doc.removeEventListener("change", this.markDirty, true)
    window.removeEventListener("nexus:singular-disk-saved", this.clearAfterFinderSave)
    this.doc.removeEventListener("turbo:frame-load", this.resetAfterFrameLoad)
    delete window.nexusWorkspaceHasSubstantiveContent
    delete window.nexusWorkspaceSubstantiveForFrameId
  }

  markDirty(event) {
    const t = event.target
    if (!t || typeof t.closest !== "function") return
    const root = t.closest("[data-singular-draft-root]")
    if (!root) return
    if (root.getAttribute("data-singular-has-linked-document") === "true") {
      window.nexusWorkspaceUnsaved = false
      return
    }
    if (!this.#rootHasSubstantiveContent(root)) return
    window.nexusWorkspaceUnsaved = true
  }

  clearAfterFinderSave(event) {
    const frameId = event.detail?.frameId
    window.nexusWorkspaceUnsaved = false
    if (!frameId) return
    const frame = this.doc.getElementById(frameId)
    if (frame?.hasAttribute?.("data-singular-draft-root")) {
      frame.setAttribute("data-singular-has-linked-document", "true")
    }
  }

  resetAfterFrameLoad(event) {
    const frame = event.target
    if (!(frame instanceof HTMLElement)) return
    if (!frame.hasAttribute("data-singular-draft-root")) return
    requestAnimationFrame(() => {
      window.nexusWorkspaceUnsaved = false
    })
  }

  #hasSubstantiveContent() {
    const root = this.doc.querySelector("[data-singular-draft-root]")
    return root ? this.#rootHasSubstantiveContent(root) : false
  }

  #substantiveContentForFrameId(frameId) {
    if (!frameId) return false
    const root = this.doc.getElementById(frameId)
    if (!root?.hasAttribute("data-singular-draft-root")) return false
    return this.#rootHasSubstantiveContent(root)
  }

  #taskListPayloadLooksSubstantive(root) {
    const el = root.querySelector('[data-task-list-editor-target="payload"]')
    if (!el?.value) return false
    try {
      const tasks = JSON.parse(el.value)
      if (!Array.isArray(tasks)) return false
      return tasks.some((t) => {
        if (String(t?.text ?? "").trim().length > 0) return true
        const subs = Array.isArray(t?.subtasks) ? t.subtasks : []
        return subs.some((s) => String(s?.text ?? "").trim().length > 0)
      })
    } catch (_e) {
      return false
    }
  }

  #rootHasSubstantiveContent(root) {
    const list = root.querySelector("[data-task-list-editor-target='list']")
    if (list) {
      if (this.#taskListPayloadLooksSubstantive(root)) return true
      return Array.from(list.querySelectorAll(".task-item-row--main")).some((row) => {
        const mainInput = row.querySelector(".task-edit-input")
        if (mainInput) return mainInput.value.trim().length > 0
        const mainText =
          row.querySelector(".task-item-text:not(.task-item-text--subtask)")?.textContent?.trim() || ""
        if (mainText.length > 0) return true
        let cursor = row.nextElementSibling
        while (cursor && !cursor.matches(".task-item-row--main")) {
          if (cursor.matches(".task-item-row--subtask")) {
            const si = cursor.querySelector(".task-edit-input")
            if (si && si.value.trim().length > 0) return true
            const st = cursor.querySelector("[data-role='task-text']")?.textContent?.trim() || ""
            if (st.length > 0) return true
          }
          cursor = cursor.nextElementSibling
        }
        return false
      })
    }

    return false
  }
}
