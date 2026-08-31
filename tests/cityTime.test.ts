import { describe, expect, it } from 'vitest'
import { cityClock, cityHour } from '../server/safety/cityTime.ts'
import { isNight } from '../server/safety/weights.ts'

describe('cityClock', () => {
  it('reads the hour in Tel Aviv regardless of the server timezone', () => {
    // 01:42 Israel time is 22:42 UTC the previous day. A server in UTC must
    // still see 01:42, or the whole day/night model shifts by three hours.
    const instant = new Date('2026-08-30T22:42:00Z')
    expect(cityClock(instant)).toEqual({ hour: 1, minute: 42 })
  })

  it('agrees with an explicit +03:00 offset for the same instant', () => {
    expect(cityHour(new Date('2026-08-31T01:42:00+03:00'))).toBe(1)
  })

  it('handles the winter offset too', () => {
    // Israel is UTC+2 in January, so 23:00 UTC is 01:00 local the next day.
    expect(cityHour(new Date('2026-01-14T23:00:00Z'))).toBe(1)
  })
})

describe('isNight', () => {
  it('is timezone-independent', () => {
    expect(isNight(new Date('2026-08-30T22:42:00Z'))).toBe(true)
    expect(isNight(new Date('2026-08-31T11:00:00Z'))).toBe(false)
  })
})
