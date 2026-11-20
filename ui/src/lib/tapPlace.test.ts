import { describe, expect, it } from 'vitest'
import {
  angleDistance,
  angleToPosition,
  angleToUnit,
  describeAngle,
  nearestRole,
  pointerToAngle,
  positionToAngle,
  snapAngle,
} from './tapPlace'
import { placementRadius } from './setup'
import { distance } from './geometry'

const room = { widthM: 5, depthM: 4.5, listener: { x: 2.5, y: 2.3 } }

describe('tapPlace', () => {
  it('ekran farkından açı: yukarı 0, sağ 90, aşağı 180, sol -90', () => {
    expect(pointerToAngle(0, -10)).toBeCloseTo(0)
    expect(pointerToAngle(10, 0)).toBeCloseTo(90)
    expect(Math.abs(pointerToAngle(0, 10))).toBeCloseTo(180)
    expect(pointerToAngle(-10, 0)).toBeCloseTo(-90)
    expect(pointerToAngle(0, 0)).toBe(0)
  })

  it('birim çember noktası açıyla tutarlı', () => {
    const p = angleToUnit(90)
    expect(p.x).toBeCloseTo(1)
    expect(p.y).toBeCloseTo(0)
    expect(angleToUnit(0).y).toBeCloseTo(-1)
  })

  it('açı mesafesi sarmalanır', () => {
    expect(angleDistance(170, -170)).toBe(20)
    expect(angleDistance(10, 30)).toBe(20)
  })

  it('en yakın rol', () => {
    expect(nearestRole(0)).toBe('center')
    expect(nearestRole(-28)).toBe('left')
    expect(nearestRole(35)).toBe('right')
    expect(nearestRole(95)).toBe('side-right')
    expect(nearestRole(-120)).toBe('back-left')
    expect(nearestRole(150)).toBe('back-right')
    expect(nearestRole(179)).toBe('back-center')
    expect(nearestRole(-180)).toBe('back-center')
  })

  it('standart açılara yapışır, uzaktakini korur', () => {
    expect(snapAngle(33)).toBe(30)
    expect(snapAngle(-4)).toBe(0)
    expect(snapAngle(178)).toBe(180)
    expect(snapAngle(60)).toBe(60)
  })

  it('açıdan konum: yarıçap standart, açı geri okunur', () => {
    const p = angleToPosition(30, room)
    expect(distance(p, room.listener)).toBeCloseTo(placementRadius(room), 1)
    expect(positionToAngle(p, room.listener)).toBe(30)
    const front = angleToPosition(0, room)
    expect(front.x).toBeCloseTo(room.listener.x, 1)
    expect(front.y).toBeLessThan(room.listener.y)
  })

  it('konum odanın içinde kalır', () => {
    const tiny = { widthM: 2, depthM: 2, listener: { x: 0.2, y: 0.2 } }
    const p = angleToPosition(-135, tiny)
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeGreaterThanOrEqual(0)
  })

  it('yön tarifi', () => {
    expect(describeAngle(0)).toBe('Önde')
    expect(describeAngle(30)).toBe('Sağ önde')
    expect(describeAngle(-90)).toBe('Sol yanda')
    expect(describeAngle(135)).toBe('Sağ arkada')
    expect(describeAngle(180)).toBe('Arkada')
  })
})
