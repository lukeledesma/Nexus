import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "credentialsModal",
    "credentialsForm",
    "credentialsInlineError",
    "credentialsCurrentPasswordRow",
    "credentialsNewPasswordRow",
    "credentialsConfirmPasswordRow",
    "credentialsNewPasswordInput",
    "credentialsConfirmPasswordInput",
    "usernameModal",
    "usernameForm",
    "usernameInlineError",
    "usernameOnlyRow",
    "usernamePasswordRow"
  ]

  connect() {
    this.boundGlobalPointerDown = this.handleGlobalPointerDown.bind(this)
    document.addEventListener("pointerdown", this.boundGlobalPointerDown)
  }

  disconnect() {
    document.removeEventListener("pointerdown", this.boundGlobalPointerDown)
  }

  openCredentialsModalWithConfirm(event) {
    event.preventDefault()
    if (!window.confirm("Are you sure you want to reset your password?")) return
    this.openModal(this.credentialsModalTarget)
  }

  openUsernameModalWithConfirm(event) {
    event.preventDefault()
    if (!window.confirm("Are you sure you want to reset your username?")) return
    this.openModal(this.usernameModalTarget)
  }

  closeCredentialsModal(event) {
    if (event) event.preventDefault()
    this.clearCredentialErrors()
    this.hideAllVisiblePasswords()
    this.closeModal(this.credentialsModalTarget)
  }

  closeUsernameModal(event) {
    if (event) event.preventDefault()
    this.clearUsernameErrors()
    this.hideAllVisiblePasswords()
    this.closeModal(this.usernameModalTarget)
  }

  backdropCloseCredentials(event) {
    if (event.target !== event.currentTarget) return
    this.closeCredentialsModal(event)
  }

  backdropCloseUsername(event) {
    if (event.target !== event.currentTarget) return
    this.closeUsernameModal(event)
  }

  openModal(modal) {
    if (!modal) return
    this.syncFrameIdFromSettingsPanel()
    this.syncModalMetaFromPanel()
    modal.hidden = false
    modal.classList.add("is-visible")
    modal.setAttribute("aria-hidden", "false")
  }

  syncFrameIdFromSettingsPanel() {
    const el = document.querySelector("[data-settings-user-frame-id]")
    const fid = el?.dataset?.settingsUserFrameId
    if (!fid) return
    ;[this.credentialsFormTarget, this.usernameFormTarget].forEach((form) => {
      if (!form) return
      const input = form.querySelector('input[name="frame_id"]')
      if (input) input.value = fid
    })
  }

  /** Modals live in layout; panel updates via Turbo — refresh header line when opening. */
  syncModalMetaFromPanel() {
    const el = document.querySelector("[data-settings-user-email]")
    if (!el) return
    const email = (el.dataset.settingsUserEmail || "").trim()
    const username = (el.dataset.settingsUserUsername || "").trim()
    const line = username.length > 0 ? `${email} | ${username}` : email
    document.querySelectorAll(".settings-user-modal-email.nexus-modal-meta").forEach((node) => {
      node.textContent = line
    })
  }

  closeModal(modal) {
    if (!modal) return
    modal.hidden = true
    modal.classList.remove("is-visible")
    modal.setAttribute("aria-hidden", "true")
  }

  async submitCredentials(event) {
    event.preventDefault()
    if (!this.hasCredentialsFormTarget) return

    this.clearCredentialErrors()

    const newPassword = this.credentialsNewPasswordInputTarget.value
    const confirmPassword = this.credentialsConfirmPasswordInputTarget.value
    if (newPassword !== confirmPassword) {
      this.markRowsInvalid([this.credentialsNewPasswordRowTarget, this.credentialsConfirmPasswordRowTarget])
      this.showInlineError(this.credentialsInlineErrorTarget, "New passwords do not match.")
      return
    }

    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    const response = await fetch(this.credentialsFormTarget.action, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: new FormData(this.credentialsFormTarget)
    })

    let payload = {}
    try {
      payload = await response.json()
    } catch (_error) {
      payload = {}
    }

    if (response.ok && payload?.ok) {
      this.closeCredentialsModal()
      this.refreshSettingsFrame(this.credentialsFormTarget)
      return
    }

    this.applyCredentialServerErrors(payload)
  }

  async submitUsername(event) {
    event.preventDefault()
    if (!this.hasUsernameFormTarget) return

    this.clearUsernameErrors()

    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    const response = await fetch(this.usernameFormTarget.action, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: new FormData(this.usernameFormTarget)
    })

    let payload = {}
    try {
      payload = await response.json()
    } catch (_error) {
      payload = {}
    }

    if (response.ok && payload?.ok) {
      this.closeUsernameModal()
      this.refreshSettingsFrame(this.usernameFormTarget)
      return
    }

    this.applyUsernameServerErrors(payload)
  }

  applyCredentialServerErrors(payload) {
    const code = payload?.code
    const message = payload?.message || "Unable to update password."
    this.showInlineError(this.credentialsInlineErrorTarget, message)

    if (code === "current_password_incorrect") {
      this.markRowsInvalid([this.credentialsCurrentPasswordRowTarget])
      return
    }

    if (code === "password_confirmation_mismatch") {
      this.markRowsInvalid([this.credentialsNewPasswordRowTarget, this.credentialsConfirmPasswordRowTarget])
      return
    }

    if (Array.isArray(payload?.fields)) {
      const rowMap = {
        current_password: this.credentialsCurrentPasswordRowTarget,
        password: this.credentialsNewPasswordRowTarget,
        password_confirmation: this.credentialsConfirmPasswordRowTarget
      }
      const rows = payload.fields.map((field) => rowMap[field]).filter(Boolean)
      this.markRowsInvalid(rows)
      return
    }

    this.markRowsInvalid([this.credentialsCurrentPasswordRowTarget])
  }

  applyUsernameServerErrors(payload) {
    const code = payload?.code
    const message = payload?.message || "Unable to update username."
    this.showInlineError(this.usernameInlineErrorTarget, message)

    if (code === "current_password_incorrect") {
      this.markRowsInvalid([this.usernameOnlyRowTarget, this.usernamePasswordRowTarget])
      return
    }

    if (Array.isArray(payload?.fields)) {
      const rowMap = {
        username: this.usernameOnlyRowTarget,
        current_password: this.usernamePasswordRowTarget
      }
      const rows = payload.fields.map((field) => rowMap[field]).filter(Boolean)
      this.markRowsInvalid(rows)
      return
    }

    this.markRowsInvalid([this.usernamePasswordRowTarget])
  }

  markRowsInvalid(rows) {
    rows.forEach((row) => row?.classList.add("is-invalid"))
  }

  clearCredentialErrors() {
    ;[
      this.credentialsCurrentPasswordRowTarget,
      this.credentialsNewPasswordRowTarget,
      this.credentialsConfirmPasswordRowTarget
    ].forEach((row) => row?.classList.remove("is-invalid"))
    this.clearInlineError(this.credentialsInlineErrorTarget)
  }

  clearUsernameErrors() {
    [this.usernameOnlyRowTarget, this.usernamePasswordRowTarget].forEach((row) => row?.classList.remove("is-invalid"))
    this.clearInlineError(this.usernameInlineErrorTarget)
  }

  showInlineError(target, message) {
    if (!target) return
    target.textContent = message
    target.hidden = false
  }

  clearInlineError(target) {
    if (!target) return
    target.textContent = ""
    target.hidden = true
  }

  startPeekPassword(event) {
    event.preventDefault()
    const button = event.currentTarget
    const inputId = button.dataset.passwordTargetId
    if (!inputId) return

    const input = document.getElementById(inputId)
    if (!input) return

    const visibleIcon = button.dataset.visibleIconPath || ""
    const hiddenIcon = button.dataset.hiddenIconPath || ""
    const icon = button.querySelector("img")
    this.hideAllVisiblePasswords()
    button.dataset.peeking = "true"
    button.dataset.lastSelectionStart = String(input.selectionStart ?? input.value.length)
    button.dataset.lastSelectionEnd = String(input.selectionEnd ?? input.value.length)
    input.type = "text"
    if (icon) icon.src = visibleIcon
    button.setAttribute("aria-label", "Hide password")
  }

  endPeekPassword(event) {
    event.preventDefault()
    const button = event.currentTarget
    if (button.dataset.peeking !== "true") return
    button.dataset.peeking = "false"

    const inputId = button.dataset.passwordTargetId
    if (!inputId) return
    const input = document.getElementById(inputId)
    if (!input) return

    input.type = "password"
    this.setVisibilityButtonToHidden(input.id)

    const start = Number.parseInt(button.dataset.lastSelectionStart || "", 10)
    const end = Number.parseInt(button.dataset.lastSelectionEnd || "", 10)
    input.focus({ preventScroll: true })
    if (Number.isInteger(start) && Number.isInteger(end)) {
      input.setSelectionRange(start, end)
    }
  }

  autoHidePasswordVisibility(event) {
    const input = event.currentTarget
    if (!input || input.type !== "text") return
    input.type = "password"
    this.setVisibilityButtonToHidden(input.id)
  }

  hidePasswordOnBlur(event) {
    const input = event.currentTarget
    if (!input || input.type !== "text") return
    const nextFocused = event.relatedTarget
    if (nextFocused?.classList?.contains("settings-password-visibility-btn")) {
      const targetId = nextFocused.dataset.passwordTargetId
      if (targetId && targetId === input.id) return
    }
    input.type = "password"
    this.setVisibilityButtonToHidden(input.id)
  }

  hideAllVisiblePasswords() {
    const visibleInputs = this.element.querySelectorAll(".settings-password-input[type='text']")
    visibleInputs.forEach((input) => {
      input.type = "password"
      this.setVisibilityButtonToHidden(input.id)
    })
  }

  setVisibilityButtonToHidden(inputId) {
    if (!inputId) return
    const selector = `.settings-password-visibility-btn[data-password-target-id='${CSS.escape(inputId)}']`
    const button = this.element.querySelector(selector)
    if (!button) return
    const hiddenIcon = button.dataset.hiddenIconPath || ""
    const icon = button.querySelector("img")
    if (icon && hiddenIcon) icon.src = hiddenIcon
    button.setAttribute("aria-label", "Show password")
  }

  handleGlobalPointerDown(event) {
    const visibleInputs = Array.from(this.element.querySelectorAll(".settings-password-input[type='text']"))
    if (!visibleInputs.length) return

    const clickedElement = event.target
    const keepVisible = visibleInputs.some((input) => input === clickedElement)
    if (keepVisible) return

    const toggleButton = clickedElement.closest(".settings-password-visibility-btn")
    if (toggleButton) {
      const targetId = toggleButton.dataset.passwordTargetId
      const togglesVisibleInput = visibleInputs.some((input) => input.id === targetId)
      if (togglesVisibleInput) return
    }

    this.hideAllVisiblePasswords()
  }

  refreshSettingsFrame(form) {
    const frameId = form?.querySelector("input[name='frame_id']")?.value || "settings-pane"
    const frame = document.getElementById(frameId)
    if (frame && frame.tagName === "TURBO-FRAME") {
      frame.src = `/apps/settings?section=user&frame_id=${encodeURIComponent(frameId)}`
    }
  }
}
