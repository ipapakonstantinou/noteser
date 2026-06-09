// noteser-vault-read-demo v0.1.0
//
// Reference plugin for the v1.2 `vault.read.all` capability (PR C).
// Two commands:
//   - count   : ctx.vault.read.getAllNotes() → notify with count.
//   - stream  : ctx.vault.read.stream({ chunkSize: 50 }) → notify per
//               chunk, then totals at end-of-stream.
//
// Both flows print to the worker console via ctx.notify so an
// end-to-end manual test confirms the wire works without UI surface.

export default {
  id: 'noteser-vault-read-demo',
  name: 'Vault read demo',
  version: '0.1.0',
  author: 'Noteser',
  description:
    'Reference plugin for the v1.2 vault.read.all capability. Prints a count of the notes in the vault to the worker console.',
  permissions: ['vault.read.all'],
  surfaces: {
    commands: [
      { id: 'count', title: 'Vault read demo: count notes' },
      { id: 'stream', title: 'Vault read demo: stream notes' },
    ],
  },

  async onCommand(id, ctx) {
    if (id === 'count') {
      try {
        const notes = await ctx.vault.read.getAllNotes()
        ctx.notify(`Vault read demo: getAllNotes returned ${notes.length} notes.`)
      } catch (err) {
        ctx.notify(
          `Vault read demo: getAllNotes rejected — ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return
    }
    if (id === 'stream') {
      let total = 0
      let chunks = 0
      try {
        for await (const chunk of ctx.vault.read.stream({ chunkSize: 50 })) {
          chunks++
          total += chunk.length
        }
        ctx.notify(`Vault read demo: stream returned ${total} notes across ${chunks} chunks.`)
      } catch (err) {
        ctx.notify(
          `Vault read demo: stream rejected after ${chunks} chunks — ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return
    }
  },
}
