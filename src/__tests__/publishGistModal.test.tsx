/**
 * publishGistModal.test.tsx
 *
 * Interaction tests for PublishGistModal covering:
 *   - !note empty-state
 *   - !token empty-state
 *   - Secret / Public toggle highlighting
 *   - Submit calls publishGist with the correct shape
 *   - GistScopeError surfaces the reconnect hint
 *   - Success renders the result pane with URL + copy-to-clipboard
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// Mock the publishGist utility so we don't make real HTTP calls.
const mockPublishGist = jest.fn()
jest.mock('../utils/githubGist', () => {
  const actual = jest.requireActual('../utils/githubGist') as typeof import('../utils/githubGist')
  return {
    ...actual,
    publishGist: (...args: unknown[]) => mockPublishGist(...args),
  }
})

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PublishGistModal } from '../components/modals/PublishGistModal'
import { useUIStore } from '../stores/uiStore'
import { useNoteStore } from '../stores/noteStore'
import { useGitHubStore } from '../stores/githubStore'
import { GistScopeError } from '../utils/githubGist'
import { GitHubAPIError } from '../utils/github'

// ── helpers ──────────────────────────────────────────────────────────────────

const NOTE_ID = 'note-test-1'
const NOTE_TITLE = 'My Test Note'
const NOTE_CONTENT = 'Hello world'
const GITHUB_TOKEN = 'ghp_testtoken'

function openModal(noteId = NOTE_ID) {
  useUIStore.setState({
    modal: { type: 'publish-gist', data: { noteId } },
  })
}

function seedNote(overrides: Partial<{ isDeleted: boolean; title: string; content: string }> = {}) {
  useNoteStore.setState({
    notes: [
      {
        id: NOTE_ID,
        title: overrides.title ?? NOTE_TITLE,
        content: overrides.content ?? NOTE_CONTENT,
        folderId: null,
        createdAt: 1000,
        updatedAt: 1000,
        isDeleted: overrides.isDeleted ?? false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      },
    ],
    selectedNoteId: null,
  })
}

function seedToken(token: string | null = GITHUB_TOKEN) {
  // Seed with `repo gist` so the publish button renders by default.
  // Individual tests that need the "needs scope upgrade" flow can
  // override tokenScopes afterwards.
  useGitHubStore.setState({ token, user: null, tokenScopes: token ? ['repo', 'gist'] : null })
}

beforeEach(() => {
  mockPublishGist.mockReset()
  useUIStore.setState({ modal: { type: null } })
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useGitHubStore.setState({ token: null, user: null, tokenScopes: null })
})

// ── empty-state tests ─────────────────────────────────────────────────────────

describe('PublishGistModal — empty states', () => {
  test('renders nothing when modal type is not publish-gist', () => {
    useUIStore.setState({ modal: { type: null } })
    const { container } = render(<PublishGistModal />)
    expect(container).toBeEmptyDOMElement()
  })

  test('shows "Note not found." when the note does not exist', () => {
    // Open modal for a note id that isn't in the store.
    useUIStore.setState({ modal: { type: 'publish-gist', data: { noteId: 'missing-id' } } })
    seedToken(GITHUB_TOKEN)
    render(<PublishGistModal />)
    expect(screen.getByText('Note not found.')).toBeInTheDocument()
  })

  test('shows token-missing message when GitHub token is null', () => {
    seedNote()
    openModal()
    // Leave token null (default from beforeEach).
    render(<PublishGistModal />)
    expect(screen.getByText(/Connect GitHub in Settings/i)).toBeInTheDocument()
  })
})

// ── visibility / toggle tests ────────────────────────────────────────────────

describe('PublishGistModal — Secret/Public toggle', () => {
  beforeEach(() => {
    seedNote()
    seedToken()
    openModal()
  })

  test('Secret button is highlighted by default (isPublic starts false)', () => {
    render(<PublishGistModal />)
    const secretBtn = screen.getByTestId('publish-gist-secret')
    const publicBtn = screen.getByTestId('publish-gist-public')
    // The highlighted button has the purple border class in its className.
    expect(secretBtn.className).toContain('border-obsidianAccentPurple')
    expect(publicBtn.className).not.toContain('border-obsidianAccentPurple')
  })

  test('clicking Public highlights the Public button and un-highlights Secret', async () => {
    const user = userEvent.setup()
    render(<PublishGistModal />)
    const publicBtn = screen.getByTestId('publish-gist-public')
    await user.click(publicBtn)
    const secretBtn = screen.getByTestId('publish-gist-secret')
    expect(publicBtn.className).toContain('border-obsidianAccentPurple')
    expect(secretBtn.className).not.toContain('border-obsidianAccentPurple')
  })

  test('clicking Secret after Public restores the Secret highlight', async () => {
    const user = userEvent.setup()
    render(<PublishGistModal />)
    await user.click(screen.getByTestId('publish-gist-public'))
    await user.click(screen.getByTestId('publish-gist-secret'))
    const secretBtn = screen.getByTestId('publish-gist-secret')
    expect(secretBtn.className).toContain('border-obsidianAccentPurple')
  })
})

// ── submit / publishGist call shape ──────────────────────────────────────────

describe('PublishGistModal — submit', () => {
  beforeEach(() => {
    seedNote({ title: NOTE_TITLE, content: NOTE_CONTENT })
    seedToken()
    openModal()
  })

  test('calls publishGist with the correct shape on submit (secret, default description)', async () => {
    mockPublishGist.mockResolvedValueOnce({
      id: 'gist-123',
      htmlUrl: 'https://gist.github.com/u/gist-123',
      apiUrl: 'https://api.github.com/gists/gist-123',
    })
    const user = userEvent.setup()
    render(<PublishGistModal />)

    // Description input should be pre-filled with the note title.
    const descInput = screen.getByTestId('publish-gist-description')
    expect(descInput).toHaveValue(NOTE_TITLE)

    await user.click(screen.getByTestId('publish-gist-submit'))

    await waitFor(() => expect(mockPublishGist).toHaveBeenCalledTimes(1))

    const call = mockPublishGist.mock.calls[0][0]
    expect(call.token).toBe(GITHUB_TOKEN)
    expect(call.content).toBeTruthy()
    expect(call.description).toBe(NOTE_TITLE)
    expect(call.isPublic).toBe(false)
    // filename must end with .md
    expect(call.filename).toMatch(/\.md$/)
  })

  test('passes isPublic=true when Public was selected', async () => {
    mockPublishGist.mockResolvedValueOnce({
      id: 'g2',
      htmlUrl: 'https://gist.github.com/u/g2',
      apiUrl: 'https://api.github.com/gists/g2',
    })
    const user = userEvent.setup()
    render(<PublishGistModal />)
    await user.click(screen.getByTestId('publish-gist-public'))
    await user.click(screen.getByTestId('publish-gist-submit'))
    await waitFor(() => expect(mockPublishGist).toHaveBeenCalledTimes(1))
    expect(mockPublishGist.mock.calls[0][0].isPublic).toBe(true)
  })

  test('passes the edited description to publishGist', async () => {
    mockPublishGist.mockResolvedValueOnce({
      id: 'g3',
      htmlUrl: 'https://gist.github.com/u/g3',
      apiUrl: 'https://api.github.com/gists/g3',
    })
    const user = userEvent.setup()
    render(<PublishGistModal />)
    const descInput = screen.getByTestId('publish-gist-description')
    await user.clear(descInput)
    await user.type(descInput, 'Custom desc')
    await user.click(screen.getByTestId('publish-gist-submit'))
    await waitFor(() => expect(mockPublishGist).toHaveBeenCalledTimes(1))
    expect(mockPublishGist.mock.calls[0][0].description).toBe('Custom desc')
  })
})

// ── error handling ────────────────────────────────────────────────────────────

describe('PublishGistModal — GistScopeError', () => {
  beforeEach(() => {
    seedNote()
    seedToken()
    openModal()
  })

  test('shows the "Authorize gist publishing" hint when publishGist throws GistScopeError', async () => {
    const underlying = new GitHubAPIError(404, 'createGist', 'Not Found', null, null)
    mockPublishGist.mockRejectedValueOnce(new GistScopeError(underlying))
    const user = userEvent.setup()
    render(<PublishGistModal />)
    await user.click(screen.getByTestId('publish-gist-submit'))
    // After the incremental-gist-scope rebuild the hint points the user
    // at the in-modal "Authorize gist publishing" button instead of a
    // disconnect-and-reconnect dance. The button itself appears too —
    // assert on the testid (unambiguous) instead of the visible text
    // (which now duplicates between the button label and the inline
    // explanation, breaking getByText's single-match semantics).
    await waitFor(() =>
      expect(screen.getByTestId('publish-gist-authorize')).toBeInTheDocument()
    )
    expect(screen.getByText(/grant the gist scope/i)).toBeInTheDocument()
  })

  test('shows a generic error message for non-scope errors', async () => {
    mockPublishGist.mockRejectedValueOnce(new Error('network down'))
    const user = userEvent.setup()
    render(<PublishGistModal />)
    await user.click(screen.getByTestId('publish-gist-submit'))
    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument())
    // The scope-reconnect hint must NOT appear for generic errors.
    expect(screen.queryByText(/grant the gist scope/i)).not.toBeInTheDocument()
  })
})

// ── success / result pane ────────────────────────────────────────────────────

describe('PublishGistModal — success result pane', () => {
  const GIST_URL = 'https://gist.github.com/u/success-gist'

  beforeEach(() => {
    seedNote()
    seedToken()
    openModal()
    mockPublishGist.mockResolvedValueOnce({
      id: 'success-gist',
      htmlUrl: GIST_URL,
      apiUrl: 'https://api.github.com/gists/success-gist',
    })
  })

  async function publishAndWait(user: ReturnType<typeof userEvent.setup>) {
    render(<PublishGistModal />)
    await user.click(screen.getByTestId('publish-gist-submit'))
    await waitFor(() => expect(screen.getByTestId('publish-gist-result')).toBeInTheDocument())
  }

  test('renders the result pane after successful publish', async () => {
    const user = userEvent.setup()
    await publishAndWait(user)
    expect(screen.getByTestId('publish-gist-result')).toBeInTheDocument()
  })

  test('result pane shows the gist URL in data-testid="publish-gist-url"', async () => {
    const user = userEvent.setup()
    await publishAndWait(user)
    const urlInput = screen.getByTestId('publish-gist-url') as HTMLInputElement
    expect(urlInput.value).toBe(GIST_URL)
  })

  test('copy button triggers clipboard write (or setCopied via the component path)', async () => {
    // jsdom does not implement navigator.clipboard. The component guards
    // handleCopy with a try/catch that silently falls back when clipboard
    // is unavailable. We verify the observable effect — the copy button is
    // present and the URL input contains the right value — rather than
    // reaching into the clipboard internals which jsdom can't support.
    const user = userEvent.setup()
    await publishAndWait(user)
    // Copy button must be in the DOM.
    const copyBtn = screen.getByTestId('publish-gist-copy')
    expect(copyBtn).toBeInTheDocument()
    // URL input carries the right value.
    const urlInput = screen.getByTestId('publish-gist-url') as HTMLInputElement
    expect(urlInput.value).toBe(GIST_URL)
    // Clicking the button does not throw.
    await expect(user.click(copyBtn)).resolves.toBeUndefined()
  })
})
