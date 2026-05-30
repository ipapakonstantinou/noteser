'use client'

import { useMemo, useState } from 'react'
import {
  DocumentPlusIcon,
  FolderPlusIcon,
  CloudArrowUpIcon,
  DocumentDuplicateIcon,
  RocketLaunchIcon,
  BookOpenIcon,
  SwatchIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import {
  useNoteStore,
  useFolderStore,
  useUIStore,
  useWorkspaceStore,
  useSettingsStore,
} from '@/stores'
import { STARTER_VAULTS, seedStarterVault, type StarterVault } from '@/utils/starterVaults'
import { seedFeatureTourNote } from '@/utils/featureTourNote'

// VS Code-style "Welcome" tab content. Replaces the old OnboardingModal
// popup with an in-workspace landing view that feels like a note —
// scrollable, full-bleed, dismissable by closing the tab.
//
// Sections (in order):
//   1. Hero with the product framing
//   2. "Start" — primary CTAs (new note, browse templates, connect
//      GitHub, open settings)
//   3. "Pick a starter vault" — the four curated example vaults that
//      used to live in the OnboardingModal
//   4. "Recent notes" — sorted by updatedAt (only renders when there
//      are any)
//   5. "Learn" — links to docs/demo + a "what's an Obsidian-style
//      app?" pointer
//
// Closing the tab flips `settingsStore.onboardingShown` (handled by
// workspaceStore.closeTab) so this view doesn't auto-reopen.
export const WelcomePane = ({ tabId }: { tabId: string }) => {
  const notes = useNoteStore(s => s.notes)
  const ensureFolderPath = useFolderStore(s => s.ensureFolderPath)
  const addNote = useNoteStore(s => s.addNote)
  const openModal = useUIStore(s => s.openModal)
  const openNote = useWorkspaceStore(s => s.openNote)
  const closeTab = useWorkspaceStore(s => s.closeTab)
  const setOnboardingShown = useSettingsStore(s => s.setOnboardingShown)

  const recent = useMemo(() => {
    return notes
      .filter(n => !n.isDeleted)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
  }, [notes])

  const handleNewNote = () => {
    const created = addNote({ title: 'Untitled', folderId: null, content: '' })
    openNote(created.id, { preview: false })
    // Closing the welcome tab marks onboardingShown so the user
    // doesn't bounce back here on reload.
    closeTab(tabId)
  }

  const handlePickStarter = (vault: StarterVault) => {
    const firstId = seedStarterVault(vault, { ensureFolderPath, addNote })
    setOnboardingShown(true)
    if (firstId) openNote(firstId, { preview: false })
    closeTab(tabId)
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="welcome-pane">
      <div className="max-w-3xl mx-auto px-8 py-10 space-y-10">

        {/* Hero */}
        <div>
          <div className="text-xs uppercase tracking-wider text-obsidianAccentPurple mb-2">
            Welcome
          </div>
          <h1 className="text-3xl font-semibold text-obsidianText mb-3">
            noteser
          </h1>
          <p className="text-base text-obsidianSecondaryText leading-relaxed">
            Your second brain in the browser, synced to GitHub. Markdown notes
            with wikilinks, tags, tasks, live preview, panes, templates, and a
            calm dark UI you can theme.
          </p>
        </div>

        {/* Demo clip: the live-preview editing experience. Plain <img> on
            purpose — next/image does not animate GIFs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/demo/noteser-demo.gif"
          alt="Typing a note in noteser: live-preview Markdown with wikilinks, tags, and tasks"
          className="w-full rounded-lg border border-obsidianBorder shadow-obsidian"
          loading="lazy"
        />

        {/* Coming from Obsidian — the migration path is "point at your repo
            and go", so it sits right under the hero where an Obsidian user
            sees it first. Opens the GitHub connect flow. */}
        <section aria-labelledby="welcome-obsidian">
          <button
            type="button"
            onClick={() => openModal({ type: 'github-auth' })}
            data-testid="welcome-obsidian-migrate"
            className="w-full text-left p-4 rounded-lg border border-obsidianAccentPurple/40 bg-obsidianAccentPurple/10 hover:bg-obsidianAccentPurple/20 hover:border-obsidianAccentPurple transition-colors"
          >
            <div className="flex items-center gap-3">
              <CloudArrowUpIcon className="w-6 h-6 text-obsidianAccentPurple flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div id="welcome-obsidian" className="text-base font-semibold text-obsidianText">
                  Coming from Obsidian?
                </div>
                <div className="text-xs text-obsidianSecondaryText mt-0.5 leading-snug">
                  Your vault is already plain markdown files in a folder. If that
                  folder is a GitHub repo, connect it and every note loads here
                  as-is. No export, no import step, no lock-in. The same files,
                  the same folders, and your edits sync back to the same repo.
                </div>
              </div>
              <span className="text-obsidianAccentPurple text-sm">→</span>
            </div>
          </button>
        </section>

        {/* Feature demo GIFs. One per surface so a new user scrolls through
            the whole product in 30 seconds. Plain <img> on purpose: next/image
            does not animate GIFs. All lazy-loaded so weight is fine on mobile. */}
        <section aria-labelledby="welcome-git">
          <h2 id="welcome-git" className="text-sm font-medium text-obsidianText/90 uppercase tracking-wide mb-2">
            GitHub source control
          </h2>
          <p className="text-sm text-obsidianSecondaryText mb-3">
            Commit and sync, browse recent commits, see what is pending. Your vault is a git history you can scroll.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/demo/noteser-git-demo.gif" alt="The source-control panel: Commit & Sync, vault clean, and the recent commits list" className="w-full rounded-lg border border-obsidianBorder shadow-obsidian" loading="lazy" />
        </section>

        <section aria-labelledby="welcome-calendar">
          <h2 id="welcome-calendar" className="text-sm font-medium text-obsidianText/90 uppercase tracking-wide mb-2">
            Daily notes calendar
          </h2>
          <p className="text-sm text-obsidianSecondaryText mb-3">
            Click a date, jump to the daily note. Dots mark days that already have a note.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/demo/noteser-calendar-demo.gif" alt="Calendar grid: clicking a date opens the daily note for that day" className="w-full rounded-lg border border-obsidianBorder shadow-obsidian" loading="lazy" />
        </section>

        <section aria-labelledby="welcome-tasks">
          <h2 id="welcome-tasks" className="text-sm font-medium text-obsidianText/90 uppercase tracking-wide mb-2">
            Live task queries
          </h2>
          <p className="text-sm text-obsidianSecondaryText mb-3">
            Drop a <code className="font-mono text-xs">tasks</code> code block and it renders a live list. Filter by done today, by path, by tag. Group by folder.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/demo/noteser-tasks-demo.gif" alt="A tasks code block rendering &quot;done today&quot; aggregated across the vault" className="w-full rounded-lg border border-obsidianBorder shadow-obsidian" loading="lazy" />
        </section>

        <section aria-labelledby="welcome-mobile">
          <h2 id="welcome-mobile" className="text-sm font-medium text-obsidianText/90 uppercase tracking-wide mb-2">
            On your phone
          </h2>
          <p className="text-sm text-obsidianSecondaryText mb-3">
            Same notes, same repo, mobile layout. Drawer sidebar, full editor, install as a home-screen app.
          </p>
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/demo/noteser-mobile-demo.gif" alt="Noteser on iPhone: tap the drawer, navigate the file tree, open a note" className="w-[260px] rounded-lg border border-obsidianBorder shadow-obsidian" loading="lazy" />
          </div>
        </section>

        {/* Learn — moved to the top so a first-time user lands directly
            on "click here to see what this app can do." The Feature
            tour is the visual centerpiece (full-width call-to-action
            card); the keyboard + sidebar tips are smaller bullets
            underneath for ambient discovery. */}
        <section aria-labelledby="welcome-learn">
          <h2 id="welcome-learn" className="text-sm font-medium text-obsidianText/90 uppercase tracking-wide mb-3">
            Start here
          </h2>
          <FeatureTourCard onSeeded={() => closeTab(tabId)} />
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <SparklesIcon className="w-4 h-4 mt-0.5 text-obsidianSecondaryText" />
              <span className="text-obsidianText">
                Press <kbd className="px-1 py-0.5 text-xs rounded bg-obsidianHighlight text-obsidianText">Ctrl</kbd>
                {' + '}
                <kbd className="px-1 py-0.5 text-xs rounded bg-obsidianHighlight text-obsidianText">K</kbd>
                <span className="text-obsidianSecondaryText"> to search across every note. Toggle to semantic mode for concept matches.</span>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <FolderPlusIcon className="w-4 h-4 mt-0.5 text-obsidianSecondaryText" />
              <span className="text-obsidianText">
                Right-click in the sidebar to create folders, rename, or pin panels to the top strip.
              </span>
            </li>
          </ul>
        </section>

        {/* Start */}
        <section aria-labelledby="welcome-start">
          <h2 id="welcome-start" className="text-sm font-medium text-obsidianText/90 uppercase tracking-wide mb-3">
            Start
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <WelcomeAction
              icon={<DocumentPlusIcon className="w-5 h-5" />}
              label="New note"
              hint="Empty markdown — Alt+N anywhere"
              onClick={handleNewNote}
              testId="welcome-new-note"
            />
            <WelcomeAction
              icon={<DocumentDuplicateIcon className="w-5 h-5" />}
              label="Browse templates"
              hint="Meeting notes, weekly review, journal…"
              onClick={() => openModal({ type: 'template' })}
              testId="welcome-templates"
            />
            <WelcomeAction
              icon={<CloudArrowUpIcon className="w-5 h-5" />}
              label="Connect to GitHub"
              hint="Sync notes as a git repo — your data, your repo"
              onClick={() => openModal({ type: 'github-auth' })}
              testId="welcome-github"
            />
            <WelcomeAction
              icon={<SwatchIcon className="w-5 h-5" />}
              label="Open settings"
              hint="Theme, shortcuts, AI keys, sync cadence"
              onClick={() => openModal({ type: 'settings' })}
              testId="welcome-settings"
            />
          </div>
        </section>

        {/* Starter vaults */}
        <section aria-labelledby="welcome-starters">
          <h2 id="welcome-starters" className="text-sm font-medium text-obsidianText/90 uppercase tracking-wide mb-3">
            Or start from an example vault
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {STARTER_VAULTS.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => handlePickStarter(v)}
                data-testid={`welcome-vault-${v.id}`}
                className="text-left p-3 rounded-lg border border-obsidianBorder hover:border-obsidianAccentPurple/60 hover:bg-obsidianHighlight/40 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-obsidianText">
                  <RocketLaunchIcon className="w-4 h-4 text-obsidianAccentPurple" />
                  {v.label}
                </div>
                <div className="text-xs text-obsidianAccentPurple/80 mt-0.5">{v.tagline}</div>
                <p className="text-xs text-obsidianSecondaryText mt-2 leading-snug">
                  {v.description}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Recent notes — only when there are any */}
        {recent.length > 0 && (
          <section aria-labelledby="welcome-recent">
            <h2 id="welcome-recent" className="text-sm font-medium text-obsidianText/90 uppercase tracking-wide mb-3">
              Recent
            </h2>
            <ul className="space-y-1">
              {recent.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => { openNote(n.id, { preview: false }); closeTab(tabId) }}
                    data-testid={`welcome-recent-${n.id}`}
                    className="text-sm text-obsidianAccentPurple hover:underline"
                  >
                    {n.title || '(untitled)'}
                  </button>
                  <span className="text-xs text-obsidianSecondaryText ml-2">
                    {new Date(n.updatedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="pt-4 border-t border-obsidianBorder text-xs text-obsidianSecondaryText">
          Close this tab to dismiss the welcome view. You can always reopen it from
          {' '}<button
            type="button"
            onClick={() => openModal({ type: 'shortcuts' })}
            className="text-obsidianAccentPurple hover:underline"
          >
            the keyboard shortcuts list
          </button>
          {' '}or by clearing onboarding in Settings → General.
        </div>
      </div>
    </div>
  )
}

interface WelcomeActionProps {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  testId?: string
}

const WelcomeAction = ({ icon, label, hint, onClick, testId }: WelcomeActionProps) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="text-left p-3 rounded-lg border border-obsidianBorder hover:border-obsidianAccentPurple/60 hover:bg-obsidianHighlight/40 transition-colors"
  >
    <div className="flex items-center gap-2 text-sm font-medium text-obsidianText">
      <span className="text-obsidianAccentPurple">{icon}</span>
      {label}
    </div>
    <div className="text-xs text-obsidianSecondaryText mt-1">{hint}</div>
  </button>
)

// Full-width call-to-action card for the Feature tour. Sits at the top
// of the welcome view so a first-time user immediately sees "click here
// to see what this app can do." Async-aware: shows a "Seeding…" state
// while the 9 PNGs land in IndexedDB (~1-2s), then closes the Welcome
// tab so the seeded note becomes the active view.
const FeatureTourCard = ({ onSeeded }: { onSeeded: () => void }) => {
  const [busy, setBusy] = useState(false)
  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      await seedFeatureTourNote()
      onSeeded()
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      data-testid="welcome-feature-tour"
      className="w-full text-left p-4 rounded-lg border border-obsidianAccentPurple/40 bg-obsidianAccentPurple/10 hover:bg-obsidianAccentPurple/20 hover:border-obsidianAccentPurple transition-colors disabled:opacity-60 disabled:cursor-progress"
    >
      <div className="flex items-center gap-3">
        <BookOpenIcon className="w-6 h-6 text-obsidianAccentPurple flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-obsidianText">
            {busy ? 'Seeding tour…' : 'Take the feature tour'}
          </div>
          <div className="text-xs text-obsidianSecondaryText mt-0.5">
            Adds a `Feature tour` note + screenshots in `Files/feature-tour/` and opens it — the 30-second walkthrough of what noteser does.
          </div>
        </div>
        {!busy && <span className="text-obsidianAccentPurple text-sm">→</span>}
      </div>
    </button>
  )
}

export default WelcomePane
