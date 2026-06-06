'use client'

import { useEffect, useState } from 'react'
import { useUIStore } from '@/stores'
import { EmailSignup } from '@/components/marketing/EmailSignup'
import { isIosSafari, isStandalone } from '@/components/pwa/PwaProvider'
import { PanelHeading } from '../PanelHeading'

export function AboutPanel() {
  // Semver from package.json, paired with the short build id Vercel
  // injects per deploy (commit SHA in prod, ms timestamp on local
  // builds — see next.config.mjs). Local dev has no SHA so the
  // build id falls back to the millisecond stamp.
  const semver = process.env.NEXT_PUBLIC_NOTESER_VERSION ?? 'dev'
  const buildIdRaw = process.env.NEXT_PUBLIC_BUILD_ID ?? ''
  const buildId = buildIdRaw && buildIdRaw.length > 7 ? buildIdRaw.slice(0, 7) : buildIdRaw
  const version = buildId ? `${semver} (${buildId})` : semver
  const openModal = useUIStore(s => s.openModal)
  // iOS Safari has no install API. When the user is in a normal Safari
  // tab (not already a standalone home-screen launcher) surface the
  // manual instructions here rather than as a screen-stealing banner.
  const [showIosInstall, setShowIosInstall] = useState(false)
  useEffect(() => {
    setShowIosInstall(isIosSafari() && !isStandalone())
  }, [])
  return (
    <div className="space-y-4">
      <PanelHeading>About</PanelHeading>
      {showIosInstall && (
        <div
          className="rounded-md border border-obsidianBorder bg-obsidianGray/60 p-3 text-sm text-obsidianText"
          data-testid="ios-install-hint"
        >
          <div className="font-medium mb-1">Install noteser</div>
          <p className="text-obsidianSecondaryText">
            Tap the Share icon in Safari, then choose Add to Home Screen.
            The app will launch from the home screen with no browser
            chrome and full offline access.
          </p>
        </div>
      )}
      <div className="text-sm text-obsidianText space-y-2">
        <p>Noteser is a browser-first markdown note-taking app.</p>
        <p>
          <span className="text-obsidianSecondaryText">Version: </span>
          <span className="font-mono text-xs">{version}</span>
        </p>
        <p>
          <a
            href="/help"
            target="_blank"
            rel="noopener noreferrer"
            className="text-obsidianAccentPurple hover:underline"
            data-testid="settings-help-link"
          >
            Help &amp; docs →
          </a>
          <span className="text-obsidianSecondaryText"> (in-app help: getting started, GitHub sync, local folder, shortcuts, FAQ)</span>
        </p>
        <p>
          <a
            href="https://github.com/ipapakonstantinou/noteser"
            target="_blank"
            rel="noopener noreferrer"
            className="text-obsidianAccentPurple hover:underline"
          >
            github.com/ipapakonstantinou/noteser
          </a>
        </p>
        <p>
          <a
            href="https://github.com/ipapakonstantinou/noteser/issues/new"
            target="_blank"
            rel="noreferrer"
            className="text-obsidianAccentPurple hover:underline"
            data-testid="settings-report-issue-link"
          >
            Report an issue on GitHub →
          </a>
          <span className="text-obsidianSecondaryText"> (opens a new GitHub issue in a new tab)</span>
        </p>
        <p>
          <a
            href="https://noteser.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-obsidianAccentPurple hover:underline"
          >
            noteser.app
          </a>
        </p>
        <p>
          <a
            href="https://noteser.thetechjon.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-obsidianAccentPurple hover:underline"
          >
            noteser.thetechjon.com
          </a>
        </p>
        <p className="text-xs text-obsidianSecondaryText pt-2">
          MIT licence.
        </p>
      </div>
      <div className="pt-2">
        <button
          type="button"
          onClick={() => openModal({ type: 'bug-report' })}
          data-testid="settings-report-bug"
          className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors"
        >
          Report a bug
        </button>
      </div>
      <div className="pt-4 border-t border-obsidianBorder">
        <div className="text-sm text-obsidianText mb-2">Get launch updates</div>
        <p className="text-xs text-obsidianSecondaryText mb-3">
          A short email when sync, mobile, and the next features land. No spam.
        </p>
        <EmailSignup source="settings-about" compact />
      </div>
    </div>
  )
}
