/**
 * When the save-picker loads Finder into the singular turbo-frame, the app DOM is replaced.
 * Snapshot before that navigation and restore after "Back" so in-app progress is unchanged.
 */

export const SINGULAR_BEFORE_SAVE_PICKER = "nexus:singular-before-save-picker"

export function singularPickerDraftKey(frameId) {
  return `nexus.singularPickerDraft.${frameId}`
}

export function writeSingularPickerDraft(frameId, payload) {
  try {
    window.sessionStorage.setItem(singularPickerDraftKey(frameId), JSON.stringify(payload))
  } catch (_e) {
    /* ignore */
  }
}

export function clearSingularPickerDraft(frameId) {
  try {
    window.sessionStorage.removeItem(singularPickerDraftKey(frameId))
  } catch (_e) {
    /* ignore */
  }
}

/** Read snapshot without removing (clear only after a successful restore). */
export function readSingularPickerDraft(frameId) {
  try {
    const raw = window.sessionStorage.getItem(singularPickerDraftKey(frameId))
    if (!raw) return null
    return JSON.parse(raw)
  } catch (_e) {
    return null
  }
}
