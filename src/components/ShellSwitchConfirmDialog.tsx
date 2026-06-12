import React from 'react'
import { ShellConfig } from '../types/terminalShells'

interface ShellSwitchConfirmDialogProps {
  fromShell: ShellConfig
  toShell: ShellConfig
  onConfirm: () => void
  onCancel: () => void
  onSkipFuture: () => void
}

const ShellSwitchConfirmDialog: React.FC<ShellSwitchConfirmDialogProps> = ({
  fromShell,
  toShell,
  onConfirm,
  onCancel,
  onSkipFuture
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'rgba(28, 30, 34, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 8,
          padding: 16,
          width: '100%',
          maxWidth: 290,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#e6e8ec'
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13.5, color: '#ff6b6b', display: 'flex', alignItems: 'center', gap: 6 }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 15 }} />
          Switch Shell Type?
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.9 }}>
          Switch from <strong style={{ color: 'var(--selection-color, #9ed1ff)' }}><i className={fromShell.icon} /> {fromShell.label}</strong> to <strong style={{ color: 'var(--selection-color, #9ed1ff)' }}><i className={toShell.icon} /> {toShell.label}</strong>?
          <div style={{ marginTop: 6, opacity: 0.6 }}>
            The active terminal session and any running processes will end.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none', cursor: 'pointer', marginTop: 2 }}>
          <input
            type="checkbox"
            id="dont-ask-switch"
            onChange={(e) => {
              if (e.target.checked) {
                onSkipFuture()
              }
            }}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="dont-ask-switch" style={{ fontSize: 11, opacity: 0.7, cursor: 'pointer' }}>
            Don&apos;t ask again
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            onClick={onCancel}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 4,
              color: '#fff',
              padding: '5px 12px',
              fontSize: 11.5,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 100ms'
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: '#ff6b6b',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              padding: '5px 12px',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 100ms'
            }}
          >
            Switch
          </button>
        </div>
      </div>
    </div>
  )
}

export default ShellSwitchConfirmDialog
