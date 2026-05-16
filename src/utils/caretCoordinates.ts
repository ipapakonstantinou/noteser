const MIRRORED_PROPS = [
  'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
  'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
  'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize',
] as const

// Returns caret pixel coordinates relative to the textarea's border-box origin.
// Add textarea.getBoundingClientRect().top/left to get client coordinates.
export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number
): { top: number; left: number } {
  const computed = window.getComputedStyle(textarea)

  const mirror = document.createElement('div')
  MIRRORED_PROPS.forEach(prop => mirror.style.setProperty(prop, computed.getPropertyValue(prop)))
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.top = '-9999px'
  mirror.style.left = '-9999px'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordBreak = 'break-word'

  mirror.textContent = textarea.value.slice(0, position)

  const caret = document.createElement('span')
  caret.textContent = textarea.value.slice(position) || '.'
  mirror.appendChild(caret)

  document.body.appendChild(mirror)
  const top = caret.offsetTop + parseInt(computed.borderTopWidth)
  const left = caret.offsetLeft + parseInt(computed.borderLeftWidth)
  document.body.removeChild(mirror)

  return { top, left }
}
