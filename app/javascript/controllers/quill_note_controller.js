import { Controller } from "@hotwired/stimulus"

const QUILL_SCRIPT_SRC = "https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js"
const QUILL_STYLE_HREF = "https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.snow.css"

let quillScriptPromise = null

export default class extends Controller {
  static targets = ["editor", "bodyInput"]
  static values = {
    initialBody: { type: String, default: "" }
  }

  async connect() {
    this.quill = null
    this.syncTimer = null
    this.isHydrating = true

    if (!this.hasEditorTarget || !this.hasBodyInputTarget) return

    this.ensureQuillStylesheet()
    await this.ensureQuillScript()
    if (!window.Quill) return

    this.quill = new window.Quill(this.editorTarget, {
      theme: "snow",
      placeholder: "Start writing...",
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ align: [] }],
          ["blockquote", "code-block"],
          [{ color: [] }, { background: [] }],
          ["clean"]
        ]
      }
    })

    const startingHtml = this.decodeEscapedHtml((this.initialBodyValue || this.bodyInputTarget.value || "").toString())
    if (startingHtml.length > 0) {
      this.quill.clipboard.dangerouslyPasteHTML(startingHtml)
    }

    this.quill.on("text-change", () => {
      if (this.isHydrating) return
      this.queueSync()
    })

    this.isHydrating = false
  }

  disconnect() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer)
      this.syncTimer = null
    }
  }

  queueSync() {
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      this.syncHiddenBody()
    }, 200)
  }

  syncHiddenBody() {
    if (!this.quill || !this.hasBodyInputTarget) return

    const html = this.quill.root.innerHTML
    this.bodyInputTarget.value = html === "<p><br></p>" ? "" : html

    const form = this.element.querySelector("form")
    if (form) form.dispatchEvent(new CustomEvent("autosave:trigger", { bubbles: true }))
  }

  decodeEscapedHtml(value) {
    if (!value) return ""
    if (!value.includes("\\u003c") && !value.includes("\\u003e") && !value.includes("\\u0026")) {
      return value
    }

    return value
      .replace(/\\u003c/g, "<")
      .replace(/\\u003e/g, ">")
      .replace(/\\u0026/g, "&")
      .replace(/\\u0022/g, '"')
      .replace(/\\u0027/g, "'")
  }

  ensureQuillStylesheet() {
    const existing = document.querySelector(`link[data-quill-note='style']`)
    if (existing) return

    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = QUILL_STYLE_HREF
    link.dataset.quillNote = "style"
    document.head.appendChild(link)
  }

  ensureQuillScript() {
    if (window.Quill) return Promise.resolve()
    if (quillScriptPromise) return quillScriptPromise

    quillScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-quill-note='script']`)
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true })
        existing.addEventListener("error", () => reject(new Error("Failed to load Quill script")), { once: true })
        return
      }

      const script = document.createElement("script")
      script.src = QUILL_SCRIPT_SRC
      script.dataset.quillNote = "script"
      script.async = true
      script.addEventListener("load", () => resolve(), { once: true })
      script.addEventListener("error", () => reject(new Error("Failed to load Quill script")), { once: true })
      document.head.appendChild(script)
    })

    return quillScriptPromise
  }
}
