// noteser-event-demo v0.1.0
//
// Subscribes to every vault.events stream and toasts on each fire,
// stamping the event type in the message so a human can see the
// debounce in action.
//
// Self-contained ES module — the Worker dynamic-imports this file via
// a Blob URL. No relative imports, no SDK runtime dependency
// (`definePlugin` is identity at the worker boundary).

const unsubscribers = []

function renderPanel(ctx, counts) {
  ctx.setPanelContent('panel', {
    tag: 'text',
    value:
      `vault.events demo · ` +
      `vaultChange=${counts.vaultChange} · ` +
      `noteSaved=${counts.noteSaved} · ` +
      `activeNoteChange=${counts.activeNoteChange}`,
  })
}

export default {
  id: 'noteser-event-demo',
  name: 'Vault events demo',
  version: '0.1.0',
  author: 'Noteser',
  surfaces: {
    sidebarPanels: [{ id: 'panel', title: 'Vault events' }],
  },
  permissions: ['vault.events'],

  onActivate(ctx) {
    const counts = { vaultChange: 0, noteSaved: 0, activeNoteChange: 0 }
    renderPanel(ctx, counts)

    unsubscribers.push(
      ctx.vault.events.onVaultChange(() => {
        counts.vaultChange += 1
        ctx.notify('vault.events: onVaultChange')
        renderPanel(ctx, counts)
      }),
    )

    unsubscribers.push(
      ctx.vault.events.onNoteSaved((noteId) => {
        counts.noteSaved += 1
        ctx.notify(`vault.events: onNoteSaved(${noteId})`)
        renderPanel(ctx, counts)
      }),
    )

    unsubscribers.push(
      ctx.vault.events.onActiveNoteChange((noteId) => {
        counts.activeNoteChange += 1
        ctx.notify(
          `vault.events: onActiveNoteChange(${noteId ?? 'null'})`,
        )
        renderPanel(ctx, counts)
      }),
    )
  },

  // If the host re-mounts the panel later, refresh content without
  // re-subscribing — the onActivate subscriptions still live.
  onPanelMount(panelId, ctx) {
    ctx.setPanelContent(panelId, {
      tag: 'text',
      value: 'Listening for vault events… edit a note or switch tabs.',
    })
  },

  // Best-effort cleanup. The host also drops every subscription on
  // unload, so a missed call here only leaks until the next reboot.
  onPanelUnmount() {
    while (unsubscribers.length > 0) {
      const fn = unsubscribers.pop()
      try {
        fn()
      } catch {
        /* ignore */
      }
    }
  },
}
