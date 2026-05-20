// E2E testing hooks. Exposes a handful of internal modules on
// `window.__noteser_test` so Playwright tests can seed state, exercise
// helpers, and subscribe to store changes without driving the UI for
// every assertion. The data is already in localStorage / IndexedDB, so
// exposing the modules doesn't widen the attack surface.
//
// Imported for its side effects from `src/app/page.tsx`. No-op outside
// a browser environment so SSR / Node tests aren't affected.

import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUIStore } from '@/stores/uiStore'
import { useGitHubStore } from '@/stores/githubStore'
import {
  saveAttachment,
  putAttachmentAtPath,
  moveAttachment,
  moveAttachmentAndRewriteRefs,
  deleteAttachment,
  listAttachmentMeta,
  isAttachmentPath,
} from './attachments'
import { setLastPushedContent, getLastPushedContent } from './lastPushedContent'

declare global {
  interface Window {
    __noteser_test?: {
      stores: {
        noteStore: typeof useNoteStore
        folderStore: typeof useFolderStore
        settingsStore: typeof useSettingsStore
        workspaceStore: typeof useWorkspaceStore
        uiStore: typeof useUIStore
        githubStore: typeof useGitHubStore
      }
      attachments: {
        saveAttachment: typeof saveAttachment
        putAttachmentAtPath: typeof putAttachmentAtPath
        moveAttachment: typeof moveAttachment
        moveAttachmentAndRewriteRefs: typeof moveAttachmentAndRewriteRefs
        deleteAttachment: typeof deleteAttachment
        listAttachmentMeta: typeof listAttachmentMeta
        isAttachmentPath: typeof isAttachmentPath
      }
      lastPushedContent: {
        set: typeof setLastPushedContent
        get: typeof getLastPushedContent
      }
    }
  }
}

export function installTestHooks(): void {
  if (typeof window === 'undefined') return
  window.__noteser_test = {
    stores: {
      noteStore: useNoteStore,
      folderStore: useFolderStore,
      settingsStore: useSettingsStore,
      workspaceStore: useWorkspaceStore,
      uiStore: useUIStore,
      githubStore: useGitHubStore,
    },
    attachments: {
      saveAttachment,
      putAttachmentAtPath,
      moveAttachment,
      moveAttachmentAndRewriteRefs,
      deleteAttachment,
      listAttachmentMeta,
      isAttachmentPath,
    },
    lastPushedContent: {
      set: setLastPushedContent,
      get: getLastPushedContent,
    },
  }
}
