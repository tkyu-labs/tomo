import { rmSync } from 'node:fs'

/**
 * Deletes a test's temporary folder. On Windows the engine's children (Python, Edge) release their files a moment
 * after Tomo or Hermes stops, so a plain rmSync fails with EPERM/EBUSY and leaves the folder behind; left-over
 * engines (about 1 GB each) then fill small temp disks and later tests fail with "disk is full". Retries for a few
 * seconds; a folder that still cannot go is reported, never silently kept, and never fails the test itself.
 * @param {string | undefined} dir
 */
export function removeDir(dir) {
  if (!dir) return
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
  } catch (e) {
    console.warn(`[cleanup] could not delete ${dir}: ${e instanceof Error ? e.message : e}`)
  }
}
