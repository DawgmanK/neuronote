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
        style={{ background: enabled ? 'linear-gradient(to right, #dc2626, #991b1b)' : '#d1d5db' }}
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
