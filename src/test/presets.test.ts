import { describe, it, expect, vi, beforeEach } from 'vitest'
import { presetPanelId, buildPresetPanels, presetTabMeta } from '@/presets'

describe('presetPanelId', () => {
  it('returns deterministic id for same args', () => {
    const id1 = presetPanelId('life', 'YouTube')
    const id2 = presetPanelId('life', 'YouTube')
    expect(id1).toBe(id2)
  })

  it('has preset- prefix', () => {
    expect(presetPanelId('life', 'YouTube')).toMatch(/^preset-/)
  })

  it('includes preset name', () => {
    expect(presetPanelId('life', 'YouTube')).toContain('life')
    expect(presetPanelId('no-life', 'Editor')).toContain('no-life')
  })

  it('slugifies title', () => {
    const id = presetPanelId('life', 'YouTube')
    expect(id).toBe('preset-life-youtube')
  })

  it('handles special characters in title', () => {
    const id = presetPanelId('life', 'My Panel!! #1')
    expect(id).toBe('preset-life-my-panel-1')
  })

  it('different presets produce different ids', () => {
    expect(presetPanelId('life', 'Spotify')).not.toBe(presetPanelId('no-life', 'Spotify'))
  })
})

describe('presetTabMeta', () => {
  it('returns correct meta for life preset', () => {
    const meta = presetTabMeta('life')
    expect(meta.title).toBe('Life')
    expect(meta.color).toBe('#c026d3')
  })

  it('returns correct meta for no-life preset', () => {
    const meta = presetTabMeta('no-life')
    expect(meta.title).toBe('No-Life')
    expect(meta.color).toBe('#475569')
  })
})

describe('buildPresetPanels', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1000000)
  })

  it('returns 6 panels for life preset', () => {
    const panels = buildPresetPanels('life')
    expect(panels).toHaveLength(6)
  })

  it('returns 7 panels for no-life preset', () => {
    const panels = buildPresetPanels('no-life')
    expect(panels).toHaveLength(7)
  })

  it('all panels have required fields', () => {
    const panels = buildPresetPanels('life')
    panels.forEach(p => {
      expect(p.id).toBeTruthy()
      expect(p.type).toBeTruthy()
      expect(typeof p.x).toBe('number')
      expect(typeof p.y).toBe('number')
      expect(typeof p.width).toBe('number')
      expect(typeof p.height).toBe('number')
      expect(p.title).toBeTruthy()
    })
  })

  it('panel IDs are deterministic (preset-name format)', () => {
    const panels = buildPresetPanels('life')
    expect(panels[0].id).toBe('preset-life-youtube')
    expect(panels[1].id).toBe('preset-life-spotify')
  })

  it('sets createdAt from Date.now()', () => {
    const panels = buildPresetPanels('life')
    panels.forEach(p => {
      expect(p.createdAt).toBe(1000000)
    })
  })

  it('all life panels are browser type', () => {
    const panels = buildPresetPanels('life')
    panels.forEach(p => {
      expect(p.type).toBe('browser')
    })
  })

  it('no-life has editor, terminal, and browser types', () => {
    const panels = buildPresetPanels('no-life')
    const types = new Set(panels.map(p => p.type))
    expect(types.has('editor')).toBe(true)
    expect(types.has('terminal')).toBe(true)
    expect(types.has('browser')).toBe(true)
  })

  it('browser panels have browserTabs in settings', () => {
    const panels = buildPresetPanels('life')
    panels.forEach(p => {
      if (p.type === 'browser') {
        expect(p.settings).toBeTruthy()
        const settings = p.settings as Record<string, unknown>
        expect(settings.browserTabs).toBeTruthy()
        expect(Array.isArray(settings.browserTabs)).toBe(true)
      }
    })
  })

  it('kiosk panels have kiosk setting', () => {
    const panels = buildPresetPanels('life')
    panels.forEach(p => {
      const settings = p.settings as Record<string, unknown>
      expect(settings.kiosk).toBe(true)
    })
  })

  it('life panels start asleep (lazyLoad: true)', () => {
    const panels = buildPresetPanels('life')
    panels.forEach(p => {
      const settings = p.settings as Record<string, unknown>
      expect(settings.lazyLoad).toBe(true)
    })
  })

  it('no-life terminal starts awake (lazyLoad: false)', () => {
    const panels = buildPresetPanels('no-life')
    const terminal = panels.find(p => p.type === 'terminal')
    expect(terminal).toBeTruthy()
    const settings = terminal!.settings as Record<string, unknown>
    expect(settings.lazyLoad).toBe(false)
  })

  it('applies graveyard overrides', () => {
    const overrides = {
      'preset-life-youtube': { x: 999, y: 888, width: 1500, height: 1000, title: 'My YouTube' }
    }
    const panels = buildPresetPanels('life', overrides)
    const yt = panels.find(p => p.id === 'preset-life-youtube')!
    expect(yt.x).toBe(999)
    expect(yt.y).toBe(888)
    expect(yt.width).toBe(1500)
    expect(yt.height).toBe(1000)
    expect(yt.title).toBe('My YouTube')
  })

  it('graveyard overrides do NOT change browser URL tabs', () => {
    const overrides = {
      'preset-life-youtube': {
        settings: {
          browserTabs: [{ id: 'custom', url: 'https://hacked.com', title: 'Hacked' }],
          browserActiveTabId: 'custom'
        }
      }
    }
    const panels = buildPresetPanels('life', overrides)
    const yt = panels.find(p => p.id === 'preset-life-youtube')!
    const settings = yt.settings as Record<string, unknown>
    const tabs = settings.browserTabs as Array<{ url: string }>
    // Should keep original YouTube URL, not the hacked override
    expect(tabs[0].url).toBe('https://www.youtube.com/')
  })

  it('returns empty array for unknown preset name', () => {
    // @ts-expect-error — testing invalid input
    const panels = buildPresetPanels('unknown-preset')
    expect(panels).toEqual([])
  })

  it('zIndex values increment across panels', () => {
    const panels = buildPresetPanels('life')
    panels.forEach((p, i) => {
      expect(p.zIndex).toBe(1 + i)
    })
  })
})
