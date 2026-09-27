import { Cat } from 'lucide-react'
import type { LucideProps } from 'lucide-react'

/**
 * Cat-Bot brand mark — official Lucide `Cat` icon.
 *
 * Single UI icon language: Lucide everywhere. Platform brand SVGs
 * (Discord/Telegram/Fluxer in PlatformIcons.tsx) are the only exception
 * and keep their original source path data untouched.
 */
export default function Logo({ className, ...props }: LucideProps) {
  return <Cat className={className} aria-hidden="true" {...props} />
}
