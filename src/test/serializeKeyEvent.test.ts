import { describe, it, expect } from 'vitest'
import { serializeKeyEvent } from '@/App'

// Helper to create KeyboardEvent-shaped objects without requiring real DOM events
const key = (overrides: Partial<KeyboardEvent> & { key: string }): KeyboardEvent => ({
  key: overrides.key,
  ctrlKey: overrides.ctrlKey ?? false,
  altKey: overrides.altKey ?? false,
  shiftKey: overrides.shiftKey ?? false,
  metaKey: overrides.metaKey ?? false,
} as KeyboardEvent)

describe('serializeKeyEvent', () => {
  describe('modifier-only keys', () => {
    it('returns empty string for Control alone', () => {
      expect(serializeKeyEvent(key({ key: 'Control' }))).toBe('')
    })

    it('returns empty string for Shift alone', () => {
      expect(serializeKeyEvent(key({ key: 'Shift' }))).toBe('')
    })

    it('returns empty string for Alt alone', () => {
      expect(serializeKeyEvent(key({ key: 'Alt' }))).toBe('')
    })

    it('returns empty string for Meta alone', () => {
      expect(serializeKeyEvent(key({ key: 'Meta' }))).toBe('')
    })

    it('returns empty string for OS key', () => {
      expect(serializeKeyEvent(key({ key: 'OS' }))).toBe('')
    })

    it('returns empty string for Super key', () => {
      expect(serializeKeyEvent(key({ key: 'Super' }))).toBe('')
    })
  })

  describe('simple letters', () => {
    it('serializes plain letter', () => {
      expect(serializeKeyEvent(key({ key: 'a' }))).toBe('a')
    })

    it('lowercases uppercase letter', () => {
      expect(serializeKeyEvent(key({ key: 'A' }))).toBe('a')
    })

    it('preserves shift for uppercase letter key', () => {
      // When typing Shift+A, the key is 'A' and shiftKey is true → 'shift+a'
      expect(serializeKeyEvent(key({ key: 'A', shiftKey: true }))).toBe('shift+a')
    })
  })

  describe('ctrl combos', () => {
    it('ctrl+p', () => {
      expect(serializeKeyEvent(key({ key: 'p', ctrlKey: true }))).toBe('ctrl+p')
    })

    it('ctrl+z', () => {
      expect(serializeKeyEvent(key({ key: 'z', ctrlKey: true }))).toBe('ctrl+z')
    })

    it('ctrl+shift+p (shift included for Ctrl combos)', () => {
      expect(serializeKeyEvent(key({ key: 'p', ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+p')
    })

    it('ctrl+alt+n', () => {
      expect(serializeKeyEvent(key({ key: 'n', ctrlKey: true, altKey: true }))).toBe('ctrl+alt+n')
    })
  })

  describe('special keys', () => {
    it('F2', () => {
      expect(serializeKeyEvent(key({ key: 'F2' }))).toBe('f2')
    })

    it('Escape', () => {
      expect(serializeKeyEvent(key({ key: 'Escape' }))).toBe('escape')
    })

    it('Enter', () => {
      expect(serializeKeyEvent(key({ key: 'Enter' }))).toBe('enter')
    })

    it('Tab', () => {
      expect(serializeKeyEvent(key({ key: 'Tab' }))).toBe('tab')
    })

    it('Backspace', () => {
      expect(serializeKeyEvent(key({ key: 'Backspace' }))).toBe('backspace')
    })

    it('ArrowUp', () => {
      expect(serializeKeyEvent(key({ key: 'ArrowUp' }))).toBe('arrowup')
    })
  })

  describe('shift with special/symbol keys', () => {
    it('shift+? includes shift (symbol, not letter)', () => {
      expect(serializeKeyEvent(key({ key: '?', shiftKey: true }))).toBe('?')
    })

    it('shift+F2 includes shift (special key, length > 1)', () => {
      expect(serializeKeyEvent(key({ key: 'F2', shiftKey: true }))).toBe('shift+f2')
    })

    it('shift+Enter', () => {
      expect(serializeKeyEvent(key({ key: 'Enter', shiftKey: true }))).toBe('shift+enter')
    })

    it('shift+Tab', () => {
      expect(serializeKeyEvent(key({ key: 'Tab', shiftKey: true }))).toBe('shift+tab')
    })
  })

  describe('meta key', () => {
    it('meta+tab', () => {
      expect(serializeKeyEvent(key({ key: 'Tab', metaKey: true }))).toBe('meta+tab')
    })

    it('ctrl+meta+p', () => {
      expect(serializeKeyEvent(key({ key: 'p', ctrlKey: true, metaKey: true }))).toBe('ctrl+meta+p')
    })
  })

  describe('combined modifiers', () => {
    it('ctrl+shift+alt+meta+x', () => {
      const result = serializeKeyEvent(key({
        key: 'x', ctrlKey: true, shiftKey: true, altKey: true, metaKey: true
      }))
      expect(result).toBe('ctrl+alt+shift+meta+x')
    })

    it('ctrl+= (equals sign)', () => {
      expect(serializeKeyEvent(key({ key: '=', ctrlKey: true }))).toBe('ctrl+=')
    })

    it('ctrl+- (minus)', () => {
      expect(serializeKeyEvent(key({ key: '-', ctrlKey: true }))).toBe('ctrl+-')
    })

    it('ctrl+\\ (backslash)', () => {
      expect(serializeKeyEvent(key({ key: '\\', ctrlKey: true }))).toBe('ctrl+\\')
    })
  })

  describe('number keys', () => {
    it('plain number', () => {
      expect(serializeKeyEvent(key({ key: '0' }))).toBe('0')
    })

    it('ctrl+0', () => {
      expect(serializeKeyEvent(key({ key: '0', ctrlKey: true }))).toBe('ctrl+0')
    })

    it('ctrl+1', () => {
      expect(serializeKeyEvent(key({ key: '1', ctrlKey: true }))).toBe('ctrl+1')
    })
  })

  describe('punctuation', () => {
    it('plain [', () => {
      expect(serializeKeyEvent(key({ key: '[' }))).toBe('[')
    })

    it('plain ]', () => {
      expect(serializeKeyEvent(key({ key: ']' }))).toBe(']')
    })

    it('plain ,', () => {
      expect(serializeKeyEvent(key({ key: ',' }))).toBe(',')
    })
  })
})
