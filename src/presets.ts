import { Panel } from './store/workspaceStore'

// A canvas preset is just a tab with a curated set of panels. The store has a
// loadPreset(name) action that creates a fresh tab with these panels. Subsequent
// changes (panel moves, login state inside webviews via persist:wts-browser, code-
// server folder selections) all save to the tab and survive restarts.
//
// Browser panels use `kiosk: true` in panel.settings so BrowserPanel hides the
// tabstrip + URL bar + dot row. Pure embedded view of the URL — no "looks like a
// browser" chrome around it. The webview's own session/cookies still persist.

export type PresetName = 'life' | 'no-life'

interface PanelSpec {
  type: Panel['type']
  title: string
  description?: string
  url?: string
  color?: string
  kiosk?: boolean
  // Explicit per-panel placement in world coordinates. Hand-tuned per preset so the
  // layout feels purposeful instead of grid-y.
  x: number
  y: number
  w: number
  h: number
}

const PRESETS: Record<PresetName, { tabTitle: string; tabColor?: string; panels: PanelSpec[] }> = {
  // Life: cinema + control-room. YouTube hero top-left, Spotify as a tall music column
  // on the right (spans both content rows for a "always-on" feel). Comms grid below in
  // a balanced 2x2 (WA + Discord above, IG + TG below). Telegram slightly lighter since
  // it's used less than the others.
  'life': {
    tabTitle: 'Life',
    tabColor: '#c026d3',
    panels: [
      { type: 'browser', title: 'YouTube',   url: 'https://www.youtube.com/',           kiosk: true, color: '#ff0033',
        x:  100, y:  100, w: 1280, h:  720 },
      { type: 'browser', title: 'Spotify',   url: 'https://open.spotify.com/',          kiosk: true, color: '#1db954',
        x: 1420, y:  100, w:  580, h: 1340 },
      { type: 'browser', title: 'WhatsApp',  url: 'https://web.whatsapp.com/',          kiosk: true, color: '#25d366',
        x:  100, y:  860, w:  620, h:  580 },
      { type: 'browser', title: 'Discord',   url: 'https://discord.com/app',            kiosk: true, color: '#5865f2',
        x:  760, y:  860, w:  620, h:  580 },
      { type: 'browser', title: 'Instagram', url: 'https://www.instagram.com/',         kiosk: true, color: '#e1306c',
        x:  100, y: 1480, w:  620, h:  540 },
      { type: 'browser', title: 'Telegram',  url: 'https://web.telegram.org/a/',        kiosk: true, color: '#0088cc',
        x:  760, y: 1480, w:  620, h:  540 }
    ]
  },
  // No-Life: workshop arrangement. Editor is the dominant left mass, terminal docks
  // under it for output, then a right column of comms/dev sites + Spotify slice at top.
  'no-life': {
    tabTitle: 'No-Life',
    tabColor: '#475569',
    panels: [
      { type: 'editor',   title: 'Editor',  description: 'code-server',
        x:  100, y:  100, w: 1280, h:  900 },
      { type: 'terminal', title: 'Terminal',
        x:  100, y: 1040, w: 1280, h:  360 },
      { type: 'browser',  title: 'Spotify',  url: 'https://open.spotify.com/',       kiosk: true, color: '#1db954',
        x: 1420, y:  100, w:  600, h:  280 },
      { type: 'browser',  title: 'Gmail',    url: 'https://mail.google.com/',        kiosk: true, color: '#ea4335',
        x: 1420, y:  420, w:  600, h:  470 },
      { type: 'browser',  title: 'GitHub',   url: 'https://github.com/',             kiosk: true, color: '#24292f',
        x: 1420, y:  930, w:  600, h:  470 },
      { type: 'browser',  title: 'LinkedIn', url: 'https://www.linkedin.com/feed/',  kiosk: true, color: '#0a66c2',
        x: 2060, y:  100, w:  640, h:  640 },
      { type: 'browser',  title: 'Reddit',   url: 'https://www.reddit.com/',         kiosk: true, color: '#ff4500',
        x: 2060, y:  780, w:  640, h:  620 }
    ]
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Deterministic id keyed on preset+title. Lets us identify "the YouTube panel in Life"
// across tab closes / app restarts so we can resurrect it from the graveyard if the
// user deleted it and re-runs loadPreset.
export const presetPanelId = (preset: PresetName, title: string) => `preset-${preset}-${slug(title)}`

export const buildPresetPanels = (name: PresetName, overrides: Record<string, Partial<Panel>> = {}): Panel[] => {
  const spec = PRESETS[name]
  if (!spec) return []
  return spec.panels.map((p, i): Panel => {
    const id = presetPanelId(name, p.title)
    const settings: Record<string, unknown> = {}
    const startsAsleep = !(name === 'no-life' && p.type === 'terminal')
    // Preset panels usually open asleep. Saved panel state may include lazyLoad:false
    // from a previous click, but loading Life/No-Life should restore the preset's
    // default sleep state. No-Life's terminal is the exception: it should be ready.
    settings.lazyLoad = startsAsleep
    if (p.type === 'browser') {
      settings.browserTabs = [{ id: `tab-${id}`, url: p.url || 'about:blank', title: p.title, incognito: false, zoom: 0 }]
      settings.browserActiveTabId = `tab-${id}`
      if (p.kiosk) settings.kiosk = true
    }
    const base: Panel = {
      id,
      type: p.type,
      x: p.x,
      y: p.y,
      width: p.w,
      height: p.h,
      title: p.title,
      description: p.description,
      color: p.color,
      zIndex: 1 + i,
      settings,
      createdAt: Date.now()
    }
    // Apply graveyard overrides on top of defaults — so resurrected panels show up at
    // their last user-customised position/size with last settings (e.g. lazyLoad
    // cleared because the user had already loaded the webview).
    const ovr = overrides[id]
    if (!ovr) return base
    const mergedSettings = {
      ...base.settings,
      ...(ovr.settings as Record<string, unknown> | undefined),
      // Browser preset panels must always reopen at their canonical app URL. If a
      // webview gets stuck on a blank/error/login redirect, preserving browserTabs
      // would resurrect that broken state forever.
      ...(p.type === 'browser' ? {
        browserTabs: settings.browserTabs,
        browserActiveTabId: settings.browserActiveTabId
      } : {}),
      lazyLoad: startsAsleep
    }
    return {
      ...base,
      x: ovr.x ?? base.x,
      y: ovr.y ?? base.y,
      width: ovr.width ?? base.width,
      height: ovr.height ?? base.height,
      title: ovr.title ?? base.title,
      color: ovr.color ?? base.color,
      description: ovr.description ?? base.description,
      settings: mergedSettings
    }
  })
}

export const presetTabMeta = (name: PresetName) => {
  const spec = PRESETS[name]
  return { title: spec.tabTitle, color: spec.tabColor }
}
