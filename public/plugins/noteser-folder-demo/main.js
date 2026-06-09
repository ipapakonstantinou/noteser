// noteser-folder-demo v0.1.0
//
// Reference plugin for the v1.2 `fs.open-directory` capability.
// Adds a single command that opens the native directory picker via
// `ctx.fs.openDirectory`, filters to `.md` / `.markdown` files, and
// toasts the resulting file count.
//
// Tests both code paths end-to-end:
//   - Chrome / Edge / Opera: `showDirectoryPicker` walked recursively.
//   - Safari / Firefox: `<input type="file" webkitdirectory>` fallback.
//
// See docs/plugins-v1.2-plan.md section 4.3 and
// docs/plugins-v1.2-impl-notes.md PR E section.

export default {
  id: 'noteser-folder-demo',
  name: 'Folder demo',
  version: '0.1.0',
  author: 'Noteser',
  description: 'Pick a folder; the plugin counts the markdown files inside.',
  permissions: ['fs.open-directory'],
  surfaces: {
    commands: [{ id: 'pick', title: 'Folder demo: count files in a folder' }],
  },

  async onCommand(id, ctx) {
    if (id !== 'pick') return
    try {
      const entries = await ctx.fs.openDirectory({ extensions: ['.md', '.markdown'] })
      if (entries === null) {
        // User cancelled the picker.
        ctx.notify('Folder pick cancelled.')
        return
      }
      const n = entries.length
      if (n === 0) {
        ctx.notify('Folder had no .md / .markdown files.')
        return
      }
      ctx.notify(`Found ${n} markdown file${n === 1 ? '' : 's'} in the picked folder.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.notify(`Folder pick failed: ${msg}`)
    }
  },
}
