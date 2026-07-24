import type { ComponentType } from 'react'
import { Bot } from 'lucide-react'
import { Platforms } from '@/constants/platform.constants'
import { DiscordIcon, TelegramIcon } from '@/components/icons/PlatformIcons'

/** Icon component-by-platform lookup — for call sites that need the raw
 *  component reference (e.g. rendered as `<Icon className={...} />` in a
 *  list alongside lucide icons that share the same `className` prop shape). */
const PLATFORM_ICON_COMPONENTS: Record<string, ComponentType<{ className?: string }>> = {
  [Platforms.Discord]: DiscordIcon,
  [Platforms.Telegram]: TelegramIcon,
}

export function getPlatformIconComponent(
  platform: string,
): ComponentType<{ className?: string }> {
  return PLATFORM_ICON_COMPONENTS[platform] ?? Bot
}

/** Convenience wrapper for call sites that just want a rendered element. */
export function getPlatformIcon(platform: string, className = 'h-5 w-5') {
  const Icon = getPlatformIconComponent(platform)
  return <Icon className={className} />
}

export function getPlatformColors(platform: string): string {
  switch (platform) {
    case Platforms.Discord:
      return 'bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/20'
    case Platforms.Telegram:
      return 'bg-[#26A5E4]/10 text-[#26A5E4] border border-[#26A5E4]/20'
    default:
      return 'bg-primary-container text-on-primary-container border border-primary/20'
  }
}
