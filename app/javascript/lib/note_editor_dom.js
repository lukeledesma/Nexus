/** Helpers for div-based contenteditable used by notes (documents/edit). */

const BLOCK_TAGS = new Set(["DIV", "P"])

function isWhitespaceTextNode(node) {
  return (
    node?.nodeType === Node.TEXT_NODE &&
    !/[^\s\u00a0\u200b]/.test(node.textContent || "")
  )
}

function isEmptyContentEditableBlock(el) {
  if (el?.nodeType !== Node.ELEMENT_NODE || !BLOCK_TAGS.has(el.tagName)) return false
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!isWhitespaceTextNode(child)) return false
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.tagName === "BR") continue
      if (BLOCK_TAGS.has(child.tagName) && isEmptyContentEditableBlock(child)) continue
      return false
    }
  }
  return true
}

/**
 * Drops trailing spacer blocks browsers add inside contenteditable (e.g. WebKit/Chromium).
 * Mutates {@param root}.
 */
export function stripTrailingEmptyBlocks(root) {
  if (!root) return
  let guard = 0
  while (guard++ < 250) {
    const last = root.lastChild
    if (!last) break
    if (isWhitespaceTextNode(last)) {
      root.removeChild(last)
      continue
    }
    if (
      last.nodeType === Node.ELEMENT_NODE &&
      BLOCK_TAGS.has(last.tagName) &&
      isEmptyContentEditableBlock(last)
    ) {
      root.removeChild(last)
      continue
    }
    break
  }
}
