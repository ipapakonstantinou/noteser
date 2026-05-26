// Pure helpers for the service-worker update flow. Kept DOM-free and
// store-free so the decision logic is trivially unit-testable; PwaProvider
// wires these to the real ServiceWorkerRegistration events.
//
// The flow: a new build registers `/sw.js?v=<buildId>`. Because the URL
// differs per deploy, the browser installs a NEW service worker. With
// skipWaiting() removed from the install handler, that worker reaches state
// 'installed' and then WAITS. We only want to prompt the user when this is a
// genuine UPDATE (an SW is already controlling the page) — never on the very
// first install (no controller yet), where activating quietly is correct.

// Should we show the "New version available — Reload" prompt for a worker
// that just reached the given lifecycle state?
//
//   - state must be 'installed' (the new worker is ready and waiting)
//   - hasController must be true (a previous SW already controls the page,
//     i.e. this is an update, not the first install)
export function shouldPromptForUpdate(
  state: string,
  hasController: boolean,
): boolean {
  return state === 'installed' && hasController === true
}

// Guard against reload loops: 'controllerchange' can fire more than once, and
// a reload that itself triggers another controllerchange must not re-reload.
// The host keeps a single boolean and routes it through this helper so the
// page reloads exactly once per accepted update.
export function shouldReloadOnControllerChange(alreadyReloaded: boolean): boolean {
  return alreadyReloaded === false
}
