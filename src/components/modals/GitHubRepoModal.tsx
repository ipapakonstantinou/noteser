'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  MagnifyingGlassIcon,
  PlusIcon,
  LockClosedIcon,
  GlobeAltIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline'
import { Modal, Button } from '@/components/ui'
import { useUIStore, useGitHubStore } from '@/stores'
import { listUserRepos, createRepo } from '@/utils/github'
import type { GitHubRepo } from '@/types'

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'error'; message: string }

export const GitHubRepoModal = () => {
  const { modal, closeModal } = useUIStore()
  const token = useGitHubStore((s) => s.token)
  const syncRepo = useGitHubStore((s) => s.syncRepo)
  const setSyncRepo = useGitHubStore((s) => s.setSyncRepo)
  const disconnect = useGitHubStore((s) => s.disconnect)

  const isOpen = modal.type === 'github-repo'

  const [view, setView] = useState<View>({ kind: 'list' })
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Create-repo form state
  const [newName, setNewName] = useState('noteser-vault')
  const [newPrivate, setNewPrivate] = useState(true)
  const [creating, setCreating] = useState(false)

  // Fetch repo list when the modal opens.
  useEffect(() => {
    if (!isOpen || !token) return
    setView({ kind: 'list' })
    setSearch('')
    setLoading(true)
    listUserRepos(token)
      .then((rs) => {
        setRepos(rs)
        setLoading(false)
      })
      .catch((err) => {
        setLoading(false)
        setView({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load repos' })
      })
  }, [isOpen, token])

  const filtered = useMemo(() => {
    if (!repos) return []
    const q = search.trim().toLowerCase()
    if (!q) return repos
    return repos.filter((r) => r.full_name.toLowerCase().includes(q))
  }, [repos, search])

  const handlePick = (repo: GitHubRepo) => {
    setSyncRepo({
      owner: repo.owner.login,
      name: repo.name,
      branch: repo.default_branch,
      isPrivate: repo.private,
    })
    closeModal()
  }

  const handleCreate = async () => {
    if (!token || !newName.trim()) return
    setCreating(true)
    try {
      const created = await createRepo(token, newName.trim(), newPrivate)
      setSyncRepo({
        owner: created.owner.login,
        name: created.name,
        branch: created.default_branch,
        isPrivate: created.private,
      })
      closeModal()
    } catch (err) {
      setView({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to create repo' })
    } finally {
      setCreating(false)
    }
  }

  const handleDisconnect = () => {
    if (confirm('Disconnect your GitHub account from Noteser?')) {
      disconnect()
      closeModal()
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="GitHub vault" size="lg">
      {view.kind === 'list' && (
        <div className="space-y-3">
          {syncRepo && (
            <div className="flex items-center gap-2 px-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded text-sm">
              <CheckCircleIcon className="w-4 h-4 text-green-500" />
              <span className="text-obsidianText">Current vault:</span>
              <code className="text-obsidianAccentPurple">{syncRepo.owner}/{syncRepo.name}</code>
              <span className="text-xs text-obsidianSecondaryText">({syncRepo.branch})</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-obsidianSecondaryText pointer-events-none" />
              <input
                type="text"
                placeholder="Filter repos…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded text-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
                autoFocus
              />
            </div>
            <button
              onClick={() => setView({ kind: 'create' })}
              className="inline-flex items-center gap-1 px-3 py-2 bg-obsidianAccentPurple text-white rounded text-sm hover:bg-opacity-90 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              New repo
            </button>
          </div>

          <div className="max-h-[400px] overflow-y-auto -mx-1 px-1">
            {loading ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <div className="animate-spin h-6 w-6 border-2 border-obsidianAccentPurple border-t-transparent rounded-full" />
                <p className="text-xs text-obsidianSecondaryText">Loading your repos…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-sm text-obsidianSecondaryText">
                {repos && repos.length === 0 ? 'No repos found.' : 'No matches.'}
              </div>
            ) : (
              <ul className="space-y-1">
                {filtered.map((repo) => {
                  const isCurrent = syncRepo?.owner === repo.owner.login && syncRepo?.name === repo.name
                  return (
                    <li key={repo.id}>
                      <button
                        onClick={() => handlePick(repo)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${
                          isCurrent
                            ? 'bg-obsidianAccentPurple/15 border border-obsidianAccentPurple/40'
                            : 'hover:bg-obsidianDarkGray border border-transparent'
                        }`}
                      >
                        {repo.private ? (
                          <LockClosedIcon className="w-4 h-4 text-obsidianSecondaryText flex-shrink-0" />
                        ) : (
                          <GlobeAltIcon className="w-4 h-4 text-obsidianSecondaryText flex-shrink-0" />
                        )}
                        <span className="flex-1 truncate text-obsidianText">{repo.full_name}</span>
                        <span className="text-xs text-obsidianSecondaryText flex-shrink-0">{repo.default_branch}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-obsidianBorder">
            <button
              onClick={handleDisconnect}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Disconnect GitHub
            </button>
            <Button variant="ghost" onClick={closeModal}>Close</Button>
          </div>
        </div>
      )}

      {view.kind === 'create' && (
        <div className="space-y-4">
          <button
            onClick={() => setView({ kind: 'list' })}
            className="inline-flex items-center gap-1 text-sm text-obsidianSecondaryText hover:text-obsidianText"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back
          </button>

          <div>
            <label className="block text-sm text-obsidianText mb-1">Repository name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="noteser-vault"
              className="w-full px-3 py-2 bg-obsidianDarkGray border border-obsidianBorder rounded text-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
              autoFocus
            />
            <p className="text-xs text-obsidianSecondaryText mt-1">
              Created under your account as a fresh repo (auto-initialized with a README).
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newPrivate}
              onChange={(e) => setNewPrivate(e.target.checked)}
              className="accent-obsidianAccentPurple"
            />
            <span className="text-sm text-obsidianText flex items-center gap-1">
              <LockClosedIcon className="w-4 h-4" /> Private repo
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setView({ kind: 'list' })}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              isLoading={creating}
              disabled={!newName.trim() || creating}
            >
              Create &amp; Use
            </Button>
          </div>
        </div>
      )}

      {view.kind === 'error' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/40 rounded">
            <ExclamationCircleIcon className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{view.message}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeModal}>Close</Button>
            <Button variant="primary" onClick={() => setView({ kind: 'list' })}>Try again</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default GitHubRepoModal
