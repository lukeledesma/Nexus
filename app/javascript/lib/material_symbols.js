/**
 * Path data mirrors app/assets/icons/material-symbol-*-24.svg (Material Symbols, 960 viewBox).
 */
const VIEW_BOX = "0 -960 960 960"

const PATHS = {
  add: "M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z",
  check: "M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z",
  circle_outline:
    "M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Z",
  close: "m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z",
  delete:
    "M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z",
  edit:
    "M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z",
  remove: "M200-440v-80h560v80H200Z"
}

const SIZE_CLASSES = {
  xs: "material-icon material-icon--xs",
  sm: "material-icon material-icon--sm",
  md: "material-icon material-icon--md",
  lg: "material-icon material-icon--lg"
}

export function materialSymbolSvg(name, size = "sm") {
  const d = PATHS[name]
  if (!d) return ""
  const cls = SIZE_CLASSES[size] || SIZE_CLASSES.sm
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="${VIEW_BOX}" class="${cls}" aria-hidden="true" fill="currentColor"><path d="${d}"/></svg>`
}
