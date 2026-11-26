import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LevelFrame } from '../api/types'
import { energyVar } from './useLevels'
import { syncWindowIdle, windowIdle } from './titlebar'

const frame = (db: number) => ({ FL: db, FR: db }) as unknown as LevelFrame
const source = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('sesle parlama (--energy)', () => {
  it('sessizken 0, iki basamakla yazılır (aynı değer yeniden yazılmaz)', () => {
    expect(energyVar(null)).toBe('0.00')
    expect(energyVar(frame(-90))).toBe('0.00')
    const loud = energyVar(frame(-3))
    expect(Number(loud)).toBeGreaterThan(0.5)
    expect(loud).toMatch(/^\d\.\d\d$/)
  })

  it('uygulamanın kökü seviyelerle yeniden çizilmez: değişken doğrudan öğeye yazılır', () => {
    const app = source('../App.tsx')
    expect(app).not.toMatch(/useLevels\(/)
    expect(app).not.toMatch(/'--energy'/)
    expect(app).toMatch(/useEnergyVar\(rootRef/)
  })
})

describe('pencere etkin değilken süs animasyonları durur', () => {
  it('yalnız çerçevesiz (masaüstü) pencere etkin değilken boşta sayılır', () => {
    expect(windowIdle({ frameless: true, maximized: false, active: false })).toBe(true)
    expect(windowIdle({ frameless: true, maximized: false, active: true })).toBe(false)
    expect(windowIdle({ frameless: false, maximized: false, active: false })).toBe(false)
  })

  it('html.window-idle sınıfı açılıp kapanır; CSS aurora perdelerini ve yıldızları durdurur', () => {
    const classes = new Set<string>()
    const root = { classList: { toggle: (n: string, on?: boolean) => (on ? classes.add(n) : classes.delete(n), !!on) } }
    syncWindowIdle(true, root)
    expect(classes.has('window-idle')).toBe(true)
    syncWindowIdle(false, root)
    expect(classes.has('window-idle')).toBe(false)
    const css = source('../index.css')
    const rule = css.slice(css.indexOf('.window-idle :is('))
    expect(rule).toMatch(/\.aurora-band/)
    expect(rule).toMatch(/\.dust/)
    expect(rule).toMatch(/animation-play-state: paused/)
    expect(rule.slice(0, rule.indexOf('}'))).not.toMatch(/radar|flow-light/)
  })
})
