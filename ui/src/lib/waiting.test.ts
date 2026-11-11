import { describe, expect, it } from 'vitest'
import { rejoinMessage, waitedLongEnough } from './waiting'

describe('waiting', () => {
  it('rejoinMessage names the devices', () => {
    expect(rejoinMessage(['Sağ hoparlör'])).toBe('Sağ hoparlör geri geldi, eklendi')
    expect(rejoinMessage(['A', 'B'])).toBe('A, B geri geldi, eklendi')
  })
  it('waitedLongEnough', () => {
    expect(waitedLongEnough(null, 100000)).toBe(false)
    expect(waitedLongEnough(0, 30000)).toBe(true)
  })
})
