import { motion, AnimatePresence } from 'framer-motion'
import { useRecordingContext } from '../contexts/RecordingContext'

/**
 * v2.3 — the app's confirm dialog, driven by RecordingContext.ask().
 *
 * window.confirm() only offers two answers and freezes the page while it is up;
 * the tab-switch prompt needs three. Rendered once at the app root so any
 * component can raise a prompt without owning modal state of its own.
 */
export default function ConfirmDialog() {
  const { confirmRequest, resolveConfirm } = useRecordingContext()

  const request = confirmRequest
  const options = request?.options || []
  // Dismissing by backdrop or Escape always takes the safe route: whichever
  // option the caller marked as the cancel value, or 'cancel'.
  const dismissValue = request?.dismissValue || 'cancel'

  return (
    <AnimatePresence>
      {request && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center px-6"
          style={{ background: 'rgba(30, 25, 20, 0.35)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => resolveConfirm(dismissValue)}
        >
          <motion.div
            className="glass w-full max-w-sm p-5"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={request.title}
          >
            <h3 className="font-mono uppercase text-xs font-bold tracking-wider mb-2">{request.title}</h3>
            {/* A div rather than a p: v2.4's legal notice passes a list, which
                is not valid inside a paragraph. */}
            <div className="text-sm text-muted leading-snug mb-4">{request.message}</div>

            <div className="flex flex-col gap-2">
              {options.map(option => (
                <button
                  key={option.value}
                  onClick={() => resolveConfirm(option.value)}
                  className={`tap-target w-full flex items-center justify-center px-4 rounded-xl font-mono uppercase text-xs tracking-wider transition-colors ${
                    option.primary
                      ? 'text-white'
                      : option.tone === 'danger'
                        ? 'text-red border border-red/30 bg-white/40'
                        : 'text-muted border border-black/10 bg-white/40 hover:text-ink'
                  }`}
                  style={option.primary ? { background: 'linear-gradient(to right, #dc2626, #991b1b)' } : undefined}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
