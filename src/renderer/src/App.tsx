import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.tomo.appInfo().then(setInfo)
  }, [])
  return (
    <main data-testid="app-root">
      <h1>Tomo（伴）</h1>
      <p data-testid="app-version">{info ? `v${info.version} · ${info.platform}` : '…'}</p>
    </main>
  )
}
