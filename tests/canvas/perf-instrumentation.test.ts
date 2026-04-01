import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Verify that performance instrumentation is wired into canvas hot-path hooks.
 *
 * Strategy: read the source files and assert that perfMark/perfMeasure calls
 * exist at the expected points. This is intentionally source-level validation
 * because full React rendering + pointer event simulation would test React
 * event plumbing rather than the instrumentation itself.
 */

const ROOT = resolve(__dirname, '../../src/renderer/src/panels/canvas')

describe('canvas perf instrumentation', () => {
  describe('use-canvas-drag.ts', () => {
    const source = readFileSync(resolve(ROOT, 'use-canvas-drag.ts'), 'utf-8')

    it('imports perf-marks', () => {
      expect(source).toContain("import { perfMark, perfMeasure } from '../../utils/perf-marks'")
    })

    it('marks drag-start', () => {
      expect(source).toContain("perfMark('drag-start')")
    })

    it('measures canvas-drag from drag-start', () => {
      expect(source).toContain("perfMeasure('canvas-drag', 'drag-start')")
    })

    it('marks resize-start', () => {
      expect(source).toContain("perfMark('resize-start')")
    })

    it('measures canvas-resize from resize-start', () => {
      expect(source).toContain("perfMeasure('canvas-resize', 'resize-start')")
    })
  })

  describe('use-canvas-viewport.ts', () => {
    const source = readFileSync(resolve(ROOT, 'use-canvas-viewport.ts'), 'utf-8')

    it('imports perf-marks', () => {
      expect(source).toContain("import { perfMark, perfMeasure } from '../../utils/perf-marks'")
    })

    it('marks wheel-start', () => {
      expect(source).toContain("perfMark('wheel-start')")
    })

    it('measures canvas-wheel from wheel-start', () => {
      expect(source).toContain("perfMeasure('canvas-wheel', 'wheel-start')")
    })

    it('marks pan-start', () => {
      expect(source).toContain("perfMark('pan-start')")
    })

    it('measures canvas-pan from pan-start', () => {
      expect(source).toContain("perfMeasure('canvas-pan', 'pan-start')")
    })
  })

  describe('perf-marks module', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('perfMark calls performance.mark in dev mode', async () => {
      const markSpy = vi
        .spyOn(performance, 'mark')
        .mockImplementation(() => ({}) as PerformanceMark)
      const { perfMark } = await import('../../src/renderer/src/utils/perf-marks')
      perfMark('test-mark')
      // In test environment import.meta.env.DEV is true
      expect(markSpy).toHaveBeenCalledWith('test-mark')
    })

    it('perfMeasure calls performance.measure and returns duration', async () => {
      const measureSpy = vi.spyOn(performance, 'measure').mockReturnValue({
        duration: 42.7,
        name: 'test',
        entryType: 'measure',
        startTime: 0,
        toJSON: () => ({})
      } as PerformanceMeasure)
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      const { perfMeasure } = await import('../../src/renderer/src/utils/perf-marks')
      const result = perfMeasure('test-measure', 'test-start')

      expect(measureSpy).toHaveBeenCalledWith('test-measure', 'test-start')
      expect(debugSpy).toHaveBeenCalledWith('[perf] test-measure: 43ms')
      expect(result).toBe(43)
    })
  })
})
