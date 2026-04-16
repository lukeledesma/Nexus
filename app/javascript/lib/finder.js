/**
 * Finder + workspace document JSON API helpers.
 */

export function finderCsrfToken() {
  return document.querySelector("meta[name='csrf-token']")?.content || ""
}

export function finderApiHeaders({ jsonBody = false } = {}) {
  const headers = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "X-CSRF-Token": finderCsrfToken()
  }
  if (jsonBody) headers["Content-Type"] = "application/json"
  return headers
}

/** For `FormData` uploads — do not set Content-Type (browser sets multipart boundary). */
export function finderMultipartHeaders() {
  return {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "X-CSRF-Token": finderCsrfToken()
  }
}

export function finderSanitizeDocumentId(raw) {
  const id = String(raw ?? "").replace(/\D/g, "")
  return id || null
}

export function finderQueryLiByNodeId(containerEl, rawId) {
  const id = finderSanitizeDocumentId(rawId)
  if (!id || !containerEl) return null
  return containerEl.querySelector(`li[data-finder-tree-node-id="${id}"]`)
}

export function finderIsFolderLiVisiblyExpanded(li) {
  if (!li?.matches?.("li.finder-tree__node--folder")) return false
  if (!li.querySelector(":scope > ul.finder-tree")) return false
  if (li.classList.contains("is-collapsed")) return false
  let wrapper = li.parentElement
  while (wrapper?.classList?.contains?.("finder-tree")) {
    const parentLi = wrapper.parentElement
    if (!parentLi?.matches?.("li.finder-tree__node--folder")) break
    if (parentLi.classList.contains("is-collapsed")) return false
    wrapper = parentLi.parentElement
    if (!wrapper?.classList?.contains?.("finder-tree")) break
  }
  return true
}

export function finderCollectExpandedFolderIdsFromDom(containerEl) {
  const ids = []
  if (!containerEl) return ids
  containerEl.querySelectorAll("li.finder-tree__node--folder.finder-tree__node--has-children").forEach((li) => {
    if (!finderIsFolderLiVisiblyExpanded(li)) return
    const id = li.dataset.finderTreeNodeId
    if (id) ids.push(String(id))
  })
  return ids
}

export function finderExpandedStorageKey(rootFolderId) {
  const id = finderSanitizeDocumentId(rootFolderId)
  return id ? `nexus.finder.expanded.${id}` : null
}

export function finderReadExpandedFolderIds(rootFolderId) {
  const key = finderExpandedStorageKey(rootFolderId)
  if (!key || typeof window === "undefined" || !window.sessionStorage) return []
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch (_e) {
    return []
  }
}

export function finderWriteExpandedFolderIds(rootFolderId, idStrings) {
  const key = finderExpandedStorageKey(rootFolderId)
  if (!key || typeof window === "undefined" || !window.sessionStorage) return
  try {
    const unique = [...new Set((idStrings || []).map(String).filter(Boolean))].sort()
    if (unique.length === 0) {
      window.sessionStorage.removeItem(key)
    } else {
      window.sessionStorage.setItem(key, JSON.stringify(unique))
    }
  } catch (_e) {
    /* ignore */
  }
}
