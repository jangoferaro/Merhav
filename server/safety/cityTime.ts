/**
 * City-local time.
 *
 * "Time is part of the address" (spec section Gimel) - so the hour a segment
 * is scored at has to be the hour in Tel Aviv, not the hour on whatever
 * machine the server happens to run on. Using `Date#getHours` would make the
 * SAFE Score depend on the deployment's TZ, which is both wrong and the kind
 * of bug that only shows up after a region change.
 *
 * When SAFE expands beyond one city (Roadmap stage 5), this becomes a property
 * of the coverage area rather than a constant.
 */

export const CITY_TIMEZONE = 'Asia/Jerusalem'

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CITY_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export interface CityClock {
  hour: number
  minute: number
}

export function cityClock(at: Date): CityClock {
  const parts = formatter.formatToParts(at)
  const value = (type: string) =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10)
  return { hour: value('hour'), minute: value('minute') }
}

export function cityHour(at: Date): number {
  return cityClock(at).hour
}
