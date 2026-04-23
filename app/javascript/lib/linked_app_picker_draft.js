/**
 * When the save-picker loads Finder into the linked app turbo-frame, the app DOM is replaced.
 * Snapshot before that navigation and restore after "Back" so in-app progress is unchanged.
 */

export const LINKED_APP_BEFORE_SAVE_PICKER = "nexus:linked-app-before-save-picker"

export function linkedAppPickerDraftKey(frameId) {
  return `nexus.linkedAppPickerDraft.${frameId}`
}

export function writeLinkedAppPickerDraft(frameId, payload) {
  try {
    window.sessionStorage.setItem(linkedAppPickerDraftKey(frameId), JSON.stringify(payload))
  } catch (_e) {
    /* ignore */
  }
}

export function clearLinkedAppPickerDraft(frameId) {
  try {
    window.sessionStorage.removeItem(linkedAppPickerDraftKey(frameId))
  } catch (_e) {
    /* ignore */
  }
}

/** Read snapshot without removing (clear only after a successful restore). */
export function readLinkedAppPickerDraft(frameId) {
  try {
    const raw = window.sessionStorage.getItem(linkedAppPickerDraftKey(frameId))
    if (!raw) return null
    return JSON.parse(raw)
  } catch (_e) {
    return null
  }
}
