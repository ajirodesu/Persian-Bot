/**
 * Author: AjiroDesu
 *
 * Chat-room settings modals (nickname, prefix, clear-chat) — lazily loaded
 * because each mounts only on explicit user action. Moved verbatim out of
 * the chat-room page bundle; no behavior or styling changes.
 */
import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { Tag, Hash, Check, Trash2 } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import Dialog from '@/components/ui/overlay/Dialog'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import { DEFAULT_NICKNAME, DEFAULT_PREFIX } from './chat-room.types'

// ── Nickname Modal ─────────────────────────────────────────────────────────────

export function NicknameModal({
  current,
  onSave,
  onClose,
}: {
  current: string
  onSave: (n: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSave = () => {
    const trimmed = value.trim().slice(0, 32) || DEFAULT_NICKNAME
    onSave(trimmed)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>Bot Nickname</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-body-md text-on-surface-variant mb-4">
              Give your bot a custom name. Say its name or use the prefix to trigger it.
            </p>
            <Field.Root>
              <Input
                ref={inputRef}
                type="text"
                value={value}
                maxLength={32}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                }}
                placeholder="e.g. Cat-Bot, Aria, Nexus…"
                leftIcon={<Tag className="h-4 w-4" />}
              />
            </Field.Root>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <Button variant="text" color="neutral" size="sm">
                Cancel
              </Button>
            </Dialog.CloseTrigger>
            <Button
              variant="filled"
              color="primary"
              size="sm"
              onClick={handleSave}
              leftIcon={<Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
            >
              Save
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}

// ── Prefix Modal ──────────────────────────────────────────────────────────────

export function PrefixModal({
  current,
  onSave,
  onClose,
}: {
  current: string
  onSave: (p: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSave = () => {
    const trimmed = value.trim().slice(0, 10) || DEFAULT_PREFIX
    onSave(trimmed)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>Edit Command Prefix</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-body-md text-on-surface-variant mb-4">
              Commands starting with this symbol trigger the bot.
            </p>
            <Field.Root>
              <Input
                ref={inputRef}
                type="text"
                value={value}
                maxLength={10}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                }}
                placeholder="e.g. / or ! or +"
                leftIcon={<Hash className="h-4 w-4" />}
              />
            </Field.Root>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <Button variant="text" color="neutral" size="sm">
                Cancel
              </Button>
            </Dialog.CloseTrigger>
            <Button
              variant="filled"
              color="primary"
              size="sm"
              onClick={handleSave}
              leftIcon={<Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
            >
              Save
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}

// ── Clear Confirm Modal ───────────────────────────────────────────────────────

export function ClearModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>Clear Chat?</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-body-md text-on-surface-variant">
              All messages in this session will be permanently removed.
            </p>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <Button variant="text" color="neutral" size="sm">
                Cancel
              </Button>
            </Dialog.CloseTrigger>
            <Button
              variant="filled"
              color="error"
              size="sm"
              onClick={() => { onConfirm(); onClose() }}
              leftIcon={<Trash2 className="w-3.5 h-3.5" strokeWidth={2.5} />}
            >
              Clear Chat
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}
