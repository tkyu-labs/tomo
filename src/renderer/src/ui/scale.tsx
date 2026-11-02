import { useEffect, useState, type ReactNode } from 'react'
import type { UiScale } from '@shared/ipc'

// Interface size (requirements: small Japanese laptops). "auto" shrinks the UI when the window is smaller than
// the designed size; CSS zoom snaps to device pixels like Electron's zoom factor.
const AUTO_BASE = { w: 1100, h: 700 }
const AUTO_MIN = 0.75

export function autoScaleFor(w: number, h: number) {
  const z = Math.min(1, w / AUTO_BASE.w, h / AUTO_BASE.h)
  return Math.max(AUTO_MIN, Math.floor(z * 100) / 100)
}

export function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return vp
}

/** --hairline = one device pixel at the current total scale. */
export function useHairline(scale: number) {
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1)
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dpr])
  useEffect(() => {
    const px = 1 / (dpr * scale)
    document.documentElement.style.setProperty('--hairline', `${Math.min(2, Math.max(0.25, px)).toFixed(4)}px`)
  }, [dpr, scale])
}

export function ScaleRoot({ scale, children }: { scale: UiScale; children: ReactNode }) {
  const vp = useViewport()
  const zoom = scale === 'auto' ? autoScaleFor(vp.w, vp.h) : scale
  useHairline(zoom)
  const h = vp.h / zoom
  useEffect(() => { document.documentElement.style.setProperty('--app-h', `${h}px`) }, [h])
  return (
    <div className="scale-root" style={{ width: vp.w / zoom, height: h, zoom: zoom === 1 ? undefined : zoom }}>
      {children}
    </div>
  )
}
