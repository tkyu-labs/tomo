import { describe, expect, it } from 'vitest'
import { compareVersions } from './pack'

describe('pack versions', () => {
  it('compares x.y.z versions', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
  })

})
