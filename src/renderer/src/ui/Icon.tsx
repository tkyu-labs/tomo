import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faArrowsRotate, faArrowUp, faArrowUpRightFromSquare, faBell, faBookmark, faCalendar, faCheck, faChevronLeft,
  faChevronRight, faCircleInfo, faCircleStop, faClock, faComment, faCopy, faCube, faEye, faFileLines, faGear,
  faGraduationCap, faKey, faLanguage, faLock, faMagnifyingGlass, faMicrochip, faPlus, faSearch, faShieldHalved,
  faTableColumns, faTrashCan, faWandMagicSparkles, faXmark,
} from '@fortawesome/free-solid-svg-icons'

// Font Awesome Free, solid only. Pack icon names (tomo-packs schema) map here too.
const icons = {
  back: faChevronLeft, plus: faPlus, chat: faComment, book: faBookmark, bell: faBell, file: faFileLines,
  language: faLanguage, settings: faGear, search: faMagnifyingGlass, panel: faTableColumns, sparkle: faWandMagicSparkles,
  check: faCheck, clock: faClock, shield: faShieldHalved, external: faArrowUpRightFromSquare, send: faArrowUp,
  chevron: faChevronRight, info: faCircleInfo, calendar: faCalendar, graduation: faGraduationCap, stop: faCircleStop,
  close: faXmark, lock: faLock, box: faCube, key: faKey, cpu: faMicrochip, refresh: faArrowsRotate, trash: faTrashCan,
  eye: faEye, copy: faCopy, find: faSearch,
} satisfies Record<string, IconDefinition>

export type IconName = keyof typeof icons
export const isIconName = (n: string): n is IconName => n in icons

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  // A bare <svg class="icon">: layout rules for text spans never hit icons. FA glyphs read large → 85 % of the box.
  const px = Math.round(size * 0.85)
  return <FontAwesomeIcon icon={icons[name]} className="icon" style={{ width: px, height: px }} aria-hidden="true" />
}
