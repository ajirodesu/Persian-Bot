/**
 * Author: AjiroDesu
 *
 * Fullscreen photo viewer for chat image attachments — lazily loaded because
 * it only mounts when the user taps a photo. Moved verbatim out of the
 * chat-room page bundle; no behavior or styling changes.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  X,
  Download,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/utils/cn.util'
import type { ChatAttachment } from './chat-room.types'

/** Renders the currently active lightbox image with its own load/zoom state — mounted fresh (via a `key` on index) each time the active image changes, so state resets naturally instead of via an effect. */
function LightboxImage({ url, fileName }: { url: string; fileName: string }) {
  const [isLoading, setIsLoading] = useState(true)
  const [isZoomed, setIsZoomed] = useState(false)

  return (
    <>
      {isLoading && (
        <span className="absolute h-8 w-8 rounded-full border-[3px] border-on-surface/25 border-t-on-surface animate-spin" />
      )}
      <img
        src={url}
        alt={fileName}
        onLoad={() => setIsLoading(false)}
        onClick={() => setIsZoomed((z) => !z)}
        draggable={false}
        className={cn(
          'rounded-[var(--radius-input)] select-none transition-transform duration-200 ease-out',
          isZoomed
            ? 'max-w-none max-h-none scale-[1.9] cursor-zoom-out'
            : 'max-w-[94vw] max-h-[86vh] object-contain cursor-zoom-in',
          isLoading && 'opacity-0',
        )}
      />
    </>
  )
}

/**
 * Fullscreen photo viewer for chat image attachments. Supports click-to-zoom,
 * download, keyboard navigation (Esc to close, ←/→ to switch), and a
 * filmstrip + prev/next controls when the triggering message has more than
 * one image attached.
 */
export default function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: ChatAttachment[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
}) {
  const current = images[index]
  const url = current?.localUrl ?? current?.url ?? ''
  const fileName = current?.name ?? 'image'
  const hasMultiple = images.length > 1

  const goPrev = useCallback(() => {
    onIndexChange((index - 1 + images.length) % images.length)
  }, [index, images.length, onIndexChange])

  const goNext = useCallback(() => {
    onIndexChange((index + 1) % images.length)
  }, [index, images.length, onIndexChange])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasMultiple) goPrev()
      else if (e.key === 'ArrowRight' && hasMultiple) goNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, goPrev, goNext, hasMultiple])

  // Lock background scroll while the lightbox is open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  if (!current || !url) return null

  return (
    <div
      className="fixed inset-0 z-modal-backdrop flex items-center justify-center bg-scrim/95 [backdrop-filter:var(--surface-blur-md)]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ animation: 'cr-fadeInFast 140ms ease both' }}
    >
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-b from-scrim/70 to-transparent z-10">
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="h-4 w-4 text-on-surface/70 shrink-0" />
          <span className="text-sm text-on-surface/90 font-medium truncate max-w-[46vw]">{fileName}</span>
          {hasMultiple && (
            <span className="text-xs text-on-surface/50 tabular-nums shrink-0">{index + 1} / {images.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={url}
            download={fileName}
            aria-label="Download image"
            className="p-2 rounded-full text-on-surface/80 hover:bg-on-surface/10 hover:text-on-surface transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="h-[18px] w-[18px]" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-full text-on-surface/80 hover:bg-on-surface/10 hover:text-on-surface transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Prev / next */}
      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev() }}
            aria-label="Previous image"
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-scrim/40 text-on-surface/80 hover:bg-scrim/60 hover:text-on-surface border border-hairline transition-colors z-10"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext() }}
            aria-label="Next image"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-scrim/40 text-on-surface/80 hover:bg-scrim/60 hover:text-on-surface border border-hairline transition-colors z-10"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Image */}
      <div
        className="relative max-w-[94vw] max-h-[86vh] flex items-center justify-center overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <LightboxImage key={index} url={url} fileName={fileName} />
      </div>

      {/* Filmstrip for multi-image messages */}
      {hasMultiple && (
        <div
          className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-1.5 px-4 py-3 bg-gradient-to-t from-scrim/70 to-transparent overflow-x-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onIndexChange(i)}
              aria-label={`View image ${i + 1}`}
              className={cn(
                'h-10 w-10 rounded-[var(--radius-input)] overflow-hidden border-2 transition-all shrink-0',
                i === index ? 'border-primary opacity-100 scale-105' : 'border-transparent opacity-50 hover:opacity-80',
              )}
            >
              <img src={img.localUrl ?? img.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
