import { motion } from 'framer-motion'
import { useRecordingContext } from '../contexts/RecordingContext'

const tabs = [
  {
    id: 'archive', label: 'Archive',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="7" height="7" rx="1.5" />
        <rect x="11" y="2" width="7" height="7" rx="1.5" />
        <rect x="2" y="11" width="7" height="7" rx="1.5" />
        <rect x="11" y="11" width="7" height="7" rx="1.5" />
      </svg>
    )
  },
  {
    id: 'capture', label: 'Capture',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="10" r="7" />
        <circle cx="10" cy="10" r="3" fill="currentColor" />
      </svg>
    )
  },
  {
    id: 'session', label: 'Session',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 10h2l2-4 2 8 2-6 2 4 2-2 2 3h2" />
      </svg>
    )
  },
  {
    id: 'system', label: 'System',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="3" />
        <path d="M10 1v2m0 14v2M1 10h2m14 0h2m-2.3-6.4-1.4 1.4M4.7 15-3.3 1.4M16.7 16.4l-1.4-1.4M4.7 5 3.3-1.4" />
      </svg>
    )
  }
]

export default function BottomNav({ activeTab, onTabChange }) {
  const { recordingState, ask, stopRecording } = useRecordingContext()

  /**
   * v2.3 — switching tabs mid-recording is safe now (the recorder lives at the
   * app root), but it should never be a surprise. The prompt leads with the
   * harmless option so a mis-tap cannot cost the user a meeting.
   */
  const handleTabTap = async (id) => {
    if (id === activeTab) return

    if (recordingState === 'recording' || recordingState === 'paused') {
      const choice = await ask({
        title: 'Recording in progress',
        message: 'Recording in progress. Switch tabs? Recording keeps running in the background either way.',
        options: [
          { label: 'Keep Recording', value: 'keep', primary: true },
          { label: 'Stop Recording First', value: 'stop' },
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

  return (
    // safe-bottom keeps the tabs clear of the iPhone home-indicator gesture area.
    <nav className="glass-nav safe-bottom fixed bottom-0 left-0 right-0 z-30">
      <div className="flex justify-around items-center px-4 pt-2 pb-2 max-w-lg mx-auto">
        {tabs.map(tab => (
          <motion.button
            key={tab.id}
            onClick={() => handleTabTap(tab.id)}
            className={`tap-target relative flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-xl transition-colors ${
              activeTab === tab.id ? 'text-red' : 'text-muted'
            }`}
            whileTap={{ scale: 0.9 }}
          >
            {tab.icon}
            <span className="font-mono uppercase text-[10px] tracking-wider font-medium">
              {tab.label}
            </span>
            {activeTab === tab.id && (
              <motion.div
                layoutId="activeTab"
                className="absolute -bottom-0.5 left-2 right-2 h-0.5 rounded-full"
                style={{ background: 'linear-gradient(to right, #dc2626, #991b1b)' }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
          </motion.button>
        ))}
      </div>
    </nav>
  )
}
