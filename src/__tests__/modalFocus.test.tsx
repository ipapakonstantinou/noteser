/**
 * modalFocus.test.tsx
 *
 * Modal's open-focus effect defers to `requestAnimationFrame` so lazily
 * mounted children are present before we pick a focus target. That frame
 * used to focus getFocusable()[0] unconditionally — which is the header's
 * X button — stealing focus back off an `autoFocus` field ~16ms after open.
 * Any Space typed after that point clicked the X and closed the modal.
 *
 * (It also made every modal test that types a string with a space in it
 * flaky on loaded CI: fast machines finish typing inside the frame, loaded
 * ones do not.)
 */
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Modal } from '../components/ui/Modal'

// Let the deferred focus frame run.
const flushFocusFrame = () => act(async () => { await new Promise(r => setTimeout(r, 40)) })

test('leaves focus alone when the dialog already owns it', async () => {
  render(
    <Modal isOpen onClose={jest.fn()} title="Edit">
      <input aria-label="Field" autoFocus />
    </Modal>,
  )
  const field = screen.getByLabelText('Field')
  expect(document.activeElement).toBe(field)

  await flushFocusFrame()
  expect(document.activeElement).toBe(field)
})

test('a Space typed after the focus frame does not close the modal', async () => {
  const onClose = jest.fn()
  render(
    <Modal isOpen onClose={onClose} title="Edit">
      <input aria-label="Field" autoFocus />
    </Modal>,
  )
  await flushFocusFrame()

  const user = userEvent.setup()
  await user.keyboard('a b')

  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Field')).toHaveValue('a b')
})

test('still pulls focus into the dialog when nothing inside has it', async () => {
  render(
    <Modal isOpen onClose={jest.fn()} title="Edit">
      <input aria-label="Field" />
    </Modal>,
  )
  expect(document.body.contains(document.activeElement)).toBe(true)
  expect(document.activeElement).toBe(document.body)

  await flushFocusFrame()
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
})
