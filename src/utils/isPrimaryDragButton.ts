// Guard used in every dragstart handler across the editor and sidebar.
//
// Firefox + Chromium-Linux fire the HTML5 dragstart event for ANY mouse
// button on a `draggable` element. The spec says browsers SHOULD ignore
// non-primary buttons, but not all do. A right-click that fires dragstart
// causes the context-menu action AND a ghost drag to happen simultaneously,
// which makes drop zones inflate unexpectedly.
//
// Passing the React drag event here is fine; we only read the native
// `button` field. Returns `true` when the drag was initiated by the
// primary (left) mouse button and should proceed.
// Mirrors the inline guard used across components:
//   if (e.nativeEvent && e.nativeEvent.button !== 0) return
// Returns false (do not drag) when nativeEvent is present and button is not 0.
export function isPrimaryDragButton(e: { nativeEvent?: { button?: number } }): boolean {
  if (!e.nativeEvent) return true
  return e.nativeEvent.button === 0
}
