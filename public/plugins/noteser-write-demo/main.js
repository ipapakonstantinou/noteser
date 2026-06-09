// noteser-write-demo v0.1.0
//
// Smoke-test plugin for the v1.2 `vault.write` capability. Adds a
// single command, "Plugin demo note", which creates a note titled
// "Plugin demo note" in the root of the vault. Running it twice
// exercises the host's title-collision resolver — the second invocation
// lands as "Plugin demo note (imported)".
//
// The plugin is intentionally tiny: it is a wire-confirmation tool, not
// a feature. Real importers (issue #73) will follow the same shape but
// loop over many notes.

export default {
  id: 'noteser-write-demo',
  name: 'Write demo',
  version: '0.1.0',
  author: 'Noteser',
  description:
    "Reference plugin for the v1.2 vault.write capability. Adds a command 'Plugin demo note' that creates a note in your vault to confirm the wire works.",
  permissions: ['vault.write'],
  surfaces: {
    commands: [{ id: 'create', title: 'Plugin demo note' }],
  },

  async onCommand(id, ctx) {
    if (id !== 'create') return
    try {
      const result = await ctx.vault.write.createNote({
        title: 'Plugin demo note',
        body:
          '# Plugin demo note\n\n' +
          'This note was created by the `noteser-write-demo` plugin to confirm the ' +
          '`vault.write` capability is wired end-to-end.\n\n' +
          `Created at: ${new Date().toISOString()}\n`,
      })
      const suffix =
        result.conflictResolved === 'suffix'
          ? ' (host renamed to avoid a title collision).'
          : '.'
      ctx.notify(`Created note "${result.id}"${suffix}`)
    } catch (err) {
      ctx.notify(`Plugin demo note failed: ${err && err.message ? err.message : String(err)}`)
    }
  },
}
