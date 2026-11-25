import { motion } from 'framer-motion'
import { useRecordingContext } from '../contexts/RecordingContext'

/**
 * v2.8 — three destinations instead of four.
 *
 * HOME holds every note, the centre orb is the recorder, and SETTINGS is
 * everything else. The old SESSION tab is gone: a note opens over HOME, both
 * from the list and automatically when a recording finishes.
 *
 * Tab ids are unchanged from v2.7 ('archive', 'capture', 'system') because the
 * recorder and the Microsoft sign-in redirect still navigate by those names.
 */
const HomeIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </svg>
)

const SettingsIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </svg>
)

const MicIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
)

function SideTab({ id, label, icon, active, onTap }) {
  return (
    <motion.button
      onClick={() => onTap(id)}
      className={`tap-target relative flex flex-col items-center justify-center gap-0.5 w-20 py-1.5 rounded-2xl transition-colors ${
        active ? 'text-accent' : 'text-muted hover:text-ink'
      }`}
      whileTap={{ scale: 0.92 }}
      aria-current={active ? 'page' : undefined}
    >
      <span style={active ? { filter: 'drop-shadow(0 0 8px rgba(42,168,255,0.8))' } : undefined}>{icon}</span>
      <span className="font-mono text-[11px] font-medium">{label}</span>
    </motion.button>
  )
}

export default function BottomNav({ activeTab, onTabChange }) {
  const { recordingState, isRecording, ask, stopRecording } = useRecordingContext()

  /**
   * v2.3 — switching tabs mid-recording is safe (the recorder lives at the app
   * root), but it should never be a surprise. The prompt leads with the
   * harmless option so a mis-tap cannot cost the user a meeting.
   */
  const handleTabTap = async (id) => {
    if (id === activeTab) return

    // Heading back to the recorder itself never needs a warning.
    const leavingRecorder = id !== 'capture'
    if (leavingRecorder && (recordingState === 'recording' || recordingState === 'paused')) {
      const choice = await ask({
        title: 'Recording in progress',
        message: 'Recording keeps running in the background either way. Switch tabs?',
        options: [
          { label: 'Keep recording', value: 'keep', primary: true },
          { label: 'Stop recording first', value: 'stop' },
          { label: 'Cancel', value: 'cancel' }
        ],
        dismissValue: 'cancel'
      })

      if (choice === 'cancel' || !choice) return
      if (choice === 'stop') {
        // Finish and save first, then land on the tab the user asked for.
        await stopRecording()
        onTabChange(id)
        return
      }
    }

    onTabChange(id)
  }

  const onRecorder = activeTab === 'capture'

  return (
    // safe-bottom keeps the bar clear of the iPhone home-indicator gesture area.
    <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-30 pointer-events-none" aria-label="Main">
      <div className="flex justify-center px-4 pb-3">
        <div
          className="chrome-ring pointer-events-auto flex items-center gap-3 px-3 py-1.5 rounded-full"
          style={{
            background: 'rgba(10, 11, 14, 0.82)',
            backdropFilter: 'blur(22px) saturate(140%)',
            WebkitBackdropFilter: 'blur(22px) saturate(140%)',
            boxShadow: '0 18px 50px rgba(0,0,0,0.75)'
          }}
        >
          <SideTab id="archive" label="Home" icon={HomeIcon} active={activeTab === 'archive'} onTap={handleTabTap} />

          <motion.button
            onClick={() => handleTabTap('capture')}
            className="relative -my-4 w-16 h-16 rounded-full flex items-center justify-center text-white"
            style={{
              background: 'var(--grad-rec)',
              boxShadow: isRecording || onRecorder ? 'var(--glow-rec)' : '0 0 0 1px rgba(255,45,85,0.35), 0 8px 24px rgba(255,45,85,0.25)'
            }}
            whileTap={{ scale: 0.92 }}
            aria-label={isRecording ? 'Recording in progress — open recorder' : 'Record'}
            aria-current={onRecorder ? 'page' : undefined}
          >
            {isRecording && <span className="orb-halo absolute inset-0 rounded-full border-2 border-rec" />}
            <span className="chrome-ring absolute inset-0 rounded-full" />
            {MicIcon}
          </motion.button>

          <SideTab id="system" label="Settings" icon={SettingsIcon} active={activeTab === 'system'} onTap={handleTabTap} />
        </div>
      </div>
    </nav>
  )
}
