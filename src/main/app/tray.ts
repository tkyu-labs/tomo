// Tray icon (Windows notification area, macOS menu bar). Closing the window keeps Tomo running here; Quit is in
// this menu (and ⌘Q on macOS). Windows: left click opens the window, right click shows the menu.
import { Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import type { Lang } from '@shared/pack/types'

type Labels = { open: string; settings: string; quit: string; hintTitle: string; hint: string }
const LABELS: Partial<Record<Lang, Labels>> & { en: Labels } = {
  en: { open: 'Open Tomo', settings: 'Settings…', quit: 'Quit Tomo', hintTitle: 'Tomo is still running', hint: 'Tomo keeps running in the notification area. To quit, right-click the Tomo icon and choose Quit Tomo. To quit on close instead: Settings → Window.' },
  zh: { open: '打开 Tomo', settings: '设置…', quit: '退出 Tomo', hintTitle: 'Tomo 仍在运行', hint: 'Tomo 会在通知区域继续运行。要退出，请右键点击 Tomo 图标，选择「退出 Tomo」。想关闭即退出：设置 → 窗口。' },
  ja: { open: 'Tomo を開く', settings: '設定…', quit: 'Tomo を終了', hintTitle: 'Tomo は実行中です', hint: 'Tomo は通知領域で動き続けます。終了するには Tomo のアイコンを右クリックして「Tomo を終了」を選んでください。閉じたら終了にするには：設定 → ウィンドウ。' },
}

export interface TrayActions { open(): void; settings(): void; quit(): void; locale(): Lang; canOpenSettings(): boolean }

export class TomoTray {
  private tray?: Tray

  constructor(private readonly iconDir: string, private readonly actions: TrayActions) {}

  create(): void {
    if (this.tray) return
    // macOS: monochrome template image (adapts to light / dark menu bars); Windows: the app icon (.ico has 16 / 32 px)
    const image = process.platform === 'darwin'
      ? nativeImage.createFromPath(join(this.iconDir, 'trayTemplate.png'))
      : nativeImage.createFromPath(join(this.iconDir, process.platform === 'win32' ? 'icon.ico' : 'icon.png')).resize({ width: 16, height: 16 })
    if (process.platform === 'darwin') image.setTemplateImage(true)
    this.tray = new Tray(image)
    this.tray.setToolTip('Tomo（伴）')
    if (process.platform !== 'darwin') this.tray.on('click', () => this.actions.open())
    this.refresh()
  }

  /** Rebuilds the menu (language or setup state changed). */
  refresh(): void {
    if (!this.tray) return
    const l = this.labels()
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: l.open, click: () => this.actions.open() },
      { label: l.settings, enabled: this.actions.canOpenSettings(), click: () => this.actions.settings() },
      { type: 'separator' },
      { label: l.quit, click: () => this.actions.quit() },
    ]))
  }

  /** Windows: explains once that closing the window does not quit Tomo. */
  showCloseHint(): void {
    if (!this.tray || process.platform !== 'win32') return
    const l = this.labels()
    this.tray.displayBalloon({ title: l.hintTitle, content: l.hint, iconType: 'info' })
  }

  private labels() {
    return LABELS[this.actions.locale()] ?? LABELS.en
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = undefined
  }
}
