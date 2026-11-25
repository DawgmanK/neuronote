import { motion } from 'framer-motion'

/**
 * Shared switch, extracted from the SYSTEM tab in v2.3 so CAPTURE's speaker
 * detection toggle looks and behaves identically.
 *
 * v2.2.1 — the track stays 48x24; the button around it is a 44px-tall target.
 */
export default function Toggle({ enabled, onChange, disabled, label }) {
  return (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      className={`tap-target -my-2.5 flex items-center justify-center flex-shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className="relative block w-12 h-6 rounded-full transition-all"
        style={{ background: enabled ? 'var(--grad-accent)' : '#23262d', boxShadow: enabled ? '0 0 14px rgba(42,168,255,0.45)' : 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}
      >
        <motion.span
          className="absolute top-0.5 block w-5 h-5 rounded-full bg-white shadow"
          animate={{ left: enabled ? 26 : 2 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        />
      </span>
    </button>
  )
}
