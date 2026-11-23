import { describe, expect, it } from 'vitest'
import { demoAzimuth } from './demo'

/** Motordaki DemoPlayerTests.TrajectoriesMatchTheUiFormulas ile aynı noktalar. */
describe('ses turu yörüngeleri (motorla aynı)', () => {
  it('aynı noktalar', () => {
    expect(demoAzimuth('orbit', 0)).toBeCloseTo(0, 6)
    expect(demoAzimuth('orbit', 2.5)).toBeCloseTo(90, 6)
    expect(demoAzimuth('orbit', 7.5)).toBeCloseTo(-90, 6)
    expect(demoAzimuth('pingpong', 0)).toBeCloseTo(-90, 6)
    expect(demoAzimuth('pingpong', 2)).toBeCloseTo(90, 6)
    expect(demoAzimuth('flyby', 7)).toBeCloseTo(180, 6)
    expect(demoAzimuth('speakers', 2.5)).toBeCloseTo(30, 6)
  })
})
