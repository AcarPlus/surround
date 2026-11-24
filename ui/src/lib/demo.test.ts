import { describe, expect, it } from 'vitest'
import { DEMO_SCENES, demoAzimuth, demoPulse } from './demo'

/** Motordaki DemoPlayerTests.TrajectoriesMatchTheUiFormulas ile aynı noktalar. */
describe('ses turu yörüngeleri (motorla aynı)', () => {
  it('aynı noktalar', () => {
    expect(demoAzimuth('orbit', 0)).toBeCloseTo(0, 6)
    expect(demoAzimuth('orbit', 2.5)).toBeCloseTo(90, 6)
    expect(demoAzimuth('orbit', 7.5)).toBeCloseTo(-90, 6)
    expect(demoAzimuth('pingpong', 0)).toBeCloseTo(-90, 6)
    expect(demoAzimuth('pingpong', 1.5)).toBeCloseTo(90, 6)
    expect(demoAzimuth('pingpong', 3)).toBeCloseTo(-90, 6)
    expect(demoAzimuth('pingpong', 0.75)).toBeCloseTo(0, 6)
    expect(demoAzimuth('flyby', 7)).toBeCloseTo(180, 6)
    expect(demoAzimuth('speakers', 2.5)).toBeCloseTo(30, 6)
  })
})

describe('ses turu sahneleri', () => {
  it('ping-pong her 0,375 sn vurur ve parlaklık vuruşta tepe yapar', () => {
    expect(DEMO_SCENES.find((s) => s.id === 'pingpong')!.beat).toBe(0.375)
    expect(demoPulse('pingpong', 0.375)).toBeCloseTo(1, 6)
    expect(demoPulse('pingpong', 0.3)).toBeLessThan(0.7)
  })
  it('çan arpejinde ikinci ve üçüncü nota da parlaklığı yükseltir', () => {
    expect(demoPulse('speakers', 0.18)).toBeGreaterThan(0.69)
    expect(demoPulse('speakers', 0.36)).toBeGreaterThan(0.49)
  })
  it('sahne süreleri motorla aynı', () => {
    expect(DEMO_SCENES.map((s) => s.duration)).toEqual([20, 15, 16, 8.4])
  })
})
