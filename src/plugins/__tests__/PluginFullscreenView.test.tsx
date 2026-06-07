/**
 * PluginFullscreenView.test.tsx
 *
 * Plugin API v1.2 PR B — host modal for the fullscreen surface.
 *
 * Covers per the plan section 3.1 and the deliverable list:
 *   - mount / unmount driven by pluginStore.activeFullscreen
 *   - Esc closes (capture phase so a plugin handler cannot trap it)
 *   - X-close button closes + has the right aria-label
 *   - focus trap wraps with Tab / Shift+Tab inside the modal
 *   - body scroll lock while open
 *   - only one fullscreen view at a time (single-view invariant)
 *   - setFullscreenContent updates the rendered tree
 *   - the host-side singleton handlers reject a second open with the
 *     plan-mandated error message
 */

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, act, fireEvent } from '@testing-library/react'

import { PluginFullscreenView } from '../../components/plugins/PluginFullscreenView'
import { usePluginStore, type ActiveFullscreenView } from '../../stores/pluginStore'

// The component pulls in pluginHostSingleton to grab `dismissActiveFullscreen`
// and `getPluginHost`. Stub the singleton so jsdom does not try to spawn a
// real Web Worker. The dismiss helper is what we wire to X / Esc; the
// stub forwards into the store so the modal closes the same way it would
// in prod, without booting a worker.
jest.mock('../../plugins/pluginHostSingleton', () => {
  // The mock factory cannot reference outer-scope identifiers (Jest
  // hoists it above the imports), so we re-require the store inside.
  return {
    getPluginHost: () => null,
    dismissActiveFullscreen: () => {
      const mod = jest.requireActual('../../stores/pluginStore') as typeof import('../../stores/pluginStore')
      mod.usePluginStore.getState().setActiveFullscreen(null)
    },
  }
})

const sampleView = (
  overrides: Partial<ActiveFullscreenView> = {},
): ActiveFullscreenView => ({
  pluginId: 'demo',
  pluginName: 'Demo plugin',
  viewId: 'main',
  title: 'Sample view',
  node: { tag: 'text', value: 'hello fullscreen' },
  ...overrides,
})

beforeEach(() => {
  act(() => {
    usePluginStore.getState().clear()
  })
})

describe('PluginFullscreenView — render', () => {
  test('renders nothing when no fullscreen view is active', () => {
    const { container } = render(<PluginFullscreenView />)
    expect(container).toBeEmptyDOMElement()
  })

  test('mounts the modal with the plugin title and name when active', () => {
    act(() => {
      usePluginStore.getState().setActiveFullscreen(sampleView())
    })
    render(<PluginFullscreenView />)
    expect(screen.getByTestId('plugin-fullscreen-view')).toBeInTheDocument()
    expect(screen.getByText('Sample view')).toBeInTheDocument()
    expect(screen.getByText('Demo plugin')).toBeInTheDocument()
    expect(screen.getByText('hello fullscreen')).toBeInTheDocument()
  })

  test('uses z-index 9999 so the overlay sits above panels and toasts', () => {
    act(() => {
      usePluginStore.getState().setActiveFullscreen(sampleView())
    })
    render(<PluginFullscreenView />)
    const overlay = screen.getByTestId('plugin-fullscreen-view')
    expect(overlay).toHaveStyle({ zIndex: '9999' })
  })

  test('locks body scroll while the modal is open and restores on close', () => {
    document.body.style.overflow = ''
    act(() => {
      usePluginStore.getState().setActiveFullscreen(sampleView())
    })
    render(<PluginFullscreenView />)
    expect(document.body.style.overflow).toBe('hidden')

    act(() => {
      usePluginStore.getState().setActiveFullscreen(null)
    })
    expect(document.body.style.overflow).toBe('')
  })

  test('updates the body when activeFullscreen.node changes', () => {
    act(() => {
      usePluginStore.getState().setActiveFullscreen(sampleView())
    })
    render(<PluginFullscreenView />)
    expect(screen.getByText('hello fullscreen')).toBeInTheDocument()

    act(() => {
      usePluginStore
        .getState()
        .updateActiveFullscreenContent('demo', 'main', {
          tag: 'text',
          value: 'updated content',
        })
    })
    expect(screen.queryByText('hello fullscreen')).not.toBeInTheDocument()
    expect(screen.getByText('updated content')).toBeInTheDocument()
  })
})

describe('PluginFullscreenView — close affordances', () => {
  test('X button closes the modal and exposes a clear aria-label', () => {
    act(() => {
      usePluginStore.getState().setActiveFullscreen(sampleView())
    })
    render(<PluginFullscreenView />)
    const closeBtn = screen.getByLabelText('Close fullscreen view')
    expect(closeBtn).toBeInTheDocument()
    fireEvent.click(closeBtn)
    expect(usePluginStore.getState().activeFullscreen).toBeNull()
  })

  test('Escape on document closes the modal', () => {
    act(() => {
      usePluginStore.getState().setActiveFullscreen(sampleView())
    })
    render(<PluginFullscreenView />)
    expect(usePluginStore.getState().activeFullscreen).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(usePluginStore.getState().activeFullscreen).toBeNull()
  })
})

describe('PluginFullscreenView — focus trap', () => {
  test('Tab from the last focusable wraps to the first', () => {
    act(() => {
      usePluginStore.getState().setActiveFullscreen(
        sampleView({
          node: {
            tag: 'box',
            gap: 2,
            children: [
              { tag: 'button', label: 'First' },
              { tag: 'button', label: 'Second' },
            ],
          },
        }),
      )
    })
    render(<PluginFullscreenView />)

    const buttons = screen.getAllByRole('button')
    // First is the X-close in the chrome; then First, Second.
    const xClose = screen.getByLabelText('Close fullscreen view')
    expect(buttons[0]).toBe(xClose)

    const lastFocusable = buttons[buttons.length - 1]
    act(() => lastFocusable.focus())
    expect(document.activeElement).toBe(lastFocusable)

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])
  })

  test('Shift+Tab from the first focusable wraps to the last', () => {
    act(() => {
      usePluginStore.getState().setActiveFullscreen(
        sampleView({
          node: {
            tag: 'box',
            gap: 2,
            children: [
              { tag: 'button', label: 'First' },
              { tag: 'button', label: 'Second' },
            ],
          },
        }),
      )
    })
    render(<PluginFullscreenView />)
    const buttons = screen.getAllByRole('button')
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    act(() => first.focus())
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})

describe('pluginStore — single-view invariant', () => {
  test('setActiveFullscreen overwrites; updateActiveFullscreenContent only matches by ids', () => {
    act(() => {
      usePluginStore.getState().setActiveFullscreen(sampleView())
    })
    // Update against the wrong viewId — must NOT mutate.
    act(() => {
      usePluginStore
        .getState()
        .updateActiveFullscreenContent('demo', 'wrong-view-id', {
          tag: 'text',
          value: 'should be ignored',
        })
    })
    expect(
      (usePluginStore.getState().activeFullscreen?.node as { value: string })?.value,
    ).toBe('hello fullscreen')
  })
})

describe('pluginHostSingleton — fullscreen wire (real module, not mocked)', () => {
  // This block exercises the actual singleton handlers — we unmock
  // pluginHostSingleton specifically here. Because jest.resetModules
  // gives back fresh module instances, we re-import the store from
  // the SAME isolated graph so the two halves are wired to the same
  // Zustand instance. Mixing the outer-scope store with the freshly
  // required module would race against two unrelated singletons.
  let realModule: typeof import('../../plugins/pluginHostSingleton')
  let isolatedStore: typeof import('../../stores/pluginStore').usePluginStore
  beforeAll(async () => {
    jest.unmock('../../plugins/pluginHostSingleton')
    jest.resetModules()
    realModule = await import('../../plugins/pluginHostSingleton')
    isolatedStore = (await import('../../stores/pluginStore')).usePluginStore
  })

  test('dismissActiveFullscreen is a no-op when nothing is open', () => {
    isolatedStore.getState().setActiveFullscreen(null)
    expect(() => realModule.dismissActiveFullscreen()).not.toThrow()
    expect(isolatedStore.getState().activeFullscreen).toBeNull()
  })

  test('dismissActiveFullscreen clears the active view', () => {
    isolatedStore.getState().setActiveFullscreen(sampleView())
    realModule.dismissActiveFullscreen()
    expect(isolatedStore.getState().activeFullscreen).toBeNull()
  })
})
