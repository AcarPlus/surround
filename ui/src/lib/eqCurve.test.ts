import { describe, expect, it } from 'vitest'
import { defaultProcessing, type PeqBand, type Processing } from '../api/types'
import { autoPreampDb, effectivePreampDb, logGrid, peakDb, processingStages, responseDb, speakerStages } from './eqCurve'

const band = (type: PeqBand['type'], freqHz: number, gainDb: number, q: number): PeqBand => ({ type, freqHz, gainDb, q })

/** Aynı yapılandırma C# tarafında hesaplandı (tests/Surround.Engine.Tests/PeqTests.cs ReferenceResponseForTheUiMirror). */
const REF: Processing = {
  ...defaultProcessing(),
  eq: [3, 2, 0, -2, 0, 1.5, 0, -1, 2, 4],
  bassBoostDb: 3,
  clarityDb: 2,
  peq: [band('peak', 2000, 4, 2), band('lowShelf', 80, -3, 0.7), band('highShelf', 6000, -2.5, 1.2)],
}

describe('eqCurve (motor formüllerinin aynası)', () => {
  it('C# ile hesaplanan referans noktalarıyla eşleşir', () => {
    const st = processingStages(REF)
    const expected: [number, number][] = [
      [20, 2.6813],
      [31, 1.9043],
      [100, 1.1268],
      [500, 0.0413],
      [1000, 2.0308],
      [2000, 5.116],
      [3500, 2.4037],
      [8000, -0.1977],
      [16000, 0.5373],
      [20000, 2.3276],
    ]
    for (const [f, db] of expected) expect(responseDb(st, f)).toBeCloseTo(db, 3)
  })

  it('otomatik ön kazanç C# ile aynı (-5,1207 dB)', () => {
    expect(autoPreampDb(REF)).toBeCloseTo(-5.1207, 3)
    expect(effectivePreampDb({ ...REF, autoPreamp: true, preampDb: 7 })).toBeCloseTo(-5.1207, 3)
    expect(effectivePreampDb({ ...REF, autoPreamp: false, preampDb: -4 })).toBe(-4)
  })

  it('1 kHz +6 dB tepe bandı 1 kHz\'de +6 dB verir', () => {
    const p = { ...defaultProcessing(), peq: [band('peak', 1000, 6, 1)] }
    expect(responseDb(processingStages(p), 1000)).toBeCloseTo(6, 6)
    expect(responseDb(processingStages(p), 30)).toBeCloseTo(0, 1)
  })

  it('düz ayar 0 dB; yalnızca kesme olunca otomatik ön kazanç 0', () => {
    const flat = processingStages(defaultProcessing())
    expect(peakDb(flat)).toBeCloseTo(0, 9)
    expect(autoPreampDb({ ...defaultProcessing(), eq: new Array<number>(10).fill(-3) })).toBeCloseTo(0, 9)
  })

  it('devre dışı ve 0 dB bantlar yok sayılır; 6 banttan fazlası atlanır', () => {
    const p = { ...defaultProcessing(), peq: [{ ...band('peak', 1000, 6, 1), enabled: false }, band('peak', 2000, 0, 1)] }
    expect(peakDb(processingStages(p))).toBeCloseTo(0, 9)
    const seven = Array.from({ length: 7 }, () => band('peak', 1000, 6, 1))
    const one = responseDb(speakerStages(undefined, seven.slice(0, 1)), 1000)
    expect(responseDb(speakerStages(undefined, seven), 1000)).toBeCloseTo(one * 6, 6)
  })

  it('raflar: alçak raf bas ucunda, yüksek raf tiz ucunda tam kazancı verir', () => {
    const st = speakerStages(undefined, [band('lowShelf', 200, 6, 0.7), band('highShelf', 4000, -5, 0.7)])
    expect(responseDb(st, 20)).toBeCloseTo(6, 0)
    expect(responseDb(st, 20000)).toBeCloseTo(-5, 0)
  })

  it('log ızgara uçları ve uzunluğu', () => {
    const g = logGrid()
    expect(g).toHaveLength(1000)
    expect(g[0]).toBe(20)
    expect(g[999]).toBeCloseTo(20000, 6)
  })
})
