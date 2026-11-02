import type { TomoApi } from '@shared/ipc'

declare global {
  interface Window {
    tomo: TomoApi
  }
}
