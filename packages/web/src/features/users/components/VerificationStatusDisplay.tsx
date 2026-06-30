import { CheckCircle2 } from 'lucide-react'
import Alert from '@/components/ui/feedback/Alert'
import type { ValidationStatus } from '@/features/users/hooks/useBotValidation'

export interface VerificationStatusDisplayProps {
  status: ValidationStatus
}

/**
 * Handles the multi-phase async UI rendering for credential verification.
 * Extracted to reduce the noise in the parent multi-step form wizard.
 */
export function VerificationStatusDisplay({
  status,
}: VerificationStatusDisplayProps) {
  if (status.phase === 'idle') return null

  if (status.phase === 'validating') {
    return (
      <p className="text-body-sm text-on-surface-variant animate-pulse">
        Verifying credentials…
      </p>
    )
  }

  if (status.phase === 'success') {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
        <span className="text-body-sm font-medium text-success">
          Credentials verified
        </span>
        {status.info && (
          <span className="text-body-sm text-on-surface-variant">
            ({status.info})
          </span>
        )}
      </div>
    )
  }

  if (status.phase === 'error') {
    return (
      <Alert
        variant="tonal"
        color="error"
        title="Verification Failed"
        message={status.message}
      />
    )
  }

  return null
}
