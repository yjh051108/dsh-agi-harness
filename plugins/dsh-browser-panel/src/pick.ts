/**
 * Front-end-dev picking: locate an element under a normalized viewport
 * coordinate and extract a stable CSS selector plus the key computed styles,
 * so the panel can offer "add this element's CSS to the conversation".
 * Coordinates are normalized (0..1 fractions of the viewport) so the client
 * never needs to know the frame or viewport pixel sizes.
 * @module @dsh-external/dsh-browser-panel/pick
 */

import type { Page } from 'playwright-core'

/** Element info returned for panel highlighting. */
export interface PickedElement {
  readonly tag: string
  readonly id?: string
  readonly classes: readonly string[]
  readonly selector: string
  readonly text: string
  /** Viewport-space bounding rect (for the panel overlay). */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly viewport: { readonly width: number; readonly height: number }
}

/** CSS extraction result: selector plus the computed styles that matter for front-end work. */
export interface CssExtraction extends PickedElement {
  readonly styles: Readonly<Record<string, string>>
}

/** Run inside the page: locate element at normalized coordinates and describe it. */
const PICK_SCRIPT = ({ xRatio, yRatio }: { xRatio: number; yRatio: number }): PickedElement | null => {
  const x = Math.round(xRatio * window.innerWidth)
  const y = Math.round(yRatio * window.innerHeight)
  const element = document.elementFromPoint(x, y)
  if (element === null) return null
  const rect = element.getBoundingClientRect()
  const selector = (() => {
    if (element.id !== '') return `#${CSS.escape(element.id)}`
    const tag = element.tagName.toLowerCase()
    const classes = [...element.classList].slice(0, 5).map(c => `.${CSS.escape(c)}`).join('')
    if (classes !== '') return `${tag}${classes}`
    // Fall back to a compact nth-of-type path (bounded depth).
    const parts: string[] = []
    let node: Element | null = element
    let depth = 0
    while (node !== null && node !== document.documentElement && depth < 4) {
      const parent: Element | null = node.parentElement
      const current: Element = node
      const position = parent === null ? 1 : [...parent.children].filter(c => c.tagName === current.tagName).indexOf(current) + 1
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${position})`)
      node = parent
      depth += 1
    }
    return parts.join(' > ')
  })()
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id === '' ? undefined : element.id,
    classes: [...element.classList].slice(0, 5),
    selector,
    text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

/** Run inside the page: locate the element and extract its key styles. */
const CSS_SCRIPT = ({ xRatio, yRatio }: { xRatio: number; yRatio: number }): CssExtraction | null => {
  const STYLE_KEYS = [
    'display', 'position', 'width', 'height', 'margin', 'padding',
    'color', 'background-color', 'font-size', 'font-weight', 'font-family',
    'line-height', 'text-align', 'border', 'border-radius', 'box-shadow',
    'flex', 'flex-direction', 'gap', 'justify-content', 'align-items',
    'overflow', 'z-index', 'opacity', 'cursor', 'transition', 'transform',
  ] as const
  const x = Math.round(xRatio * window.innerWidth)
  const y = Math.round(yRatio * window.innerHeight)
  const element = document.elementFromPoint(x, y)
  if (element === null) return null
  const rect = element.getBoundingClientRect()
  const selector = (() => {
    if (element.id !== '') return `#${CSS.escape(element.id)}`
    const tag = element.tagName.toLowerCase()
    const classes = [...element.classList].slice(0, 5).map(c => `.${CSS.escape(c)}`).join('')
    if (classes !== '') return `${tag}${classes}`
    const parts: string[] = []
    let node: Element | null = element
    let depth = 0
    while (node !== null && node !== document.documentElement && depth < 4) {
      const parent: Element | null = node.parentElement
      const current: Element = node
      const position = parent === null ? 1 : [...parent.children].filter(c => c.tagName === current.tagName).indexOf(current) + 1
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${position})`)
      node = parent
      depth += 1
    }
    return parts.join(' > ')
  })()
  const computed = getComputedStyle(element)
  const styles: Record<string, string> = {}
  for (const key of STYLE_KEYS) {
    const value = computed.getPropertyValue(key)
    if (value !== '' && value !== 'none' && value !== 'auto' && value !== '0px' && value !== 'normal') {
      styles[key] = value
    }
  }
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id === '' ? undefined : element.id,
    classes: [...element.classList].slice(0, 5),
    selector,
    text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    styles,
  }
}

/**
 * Describe the element at normalized viewport coordinates.
 * @param page - the active Playwright page.
 * @param xRatio - 0..1 fraction of viewport width.
 * @param yRatio - 0..1 fraction of viewport height.
 */
export async function pickElement(page: Page, xRatio: number, yRatio: number): Promise<PickedElement | null> {
  return await page.evaluate(PICK_SCRIPT, { xRatio, yRatio })
}

/**
 * Extract the element's stable selector and key computed styles.
 * @param page - the active Playwright page.
 * @param xRatio - 0..1 fraction of viewport width.
 * @param yRatio - 0..1 fraction of viewport height.
 */
export async function extractCss(page: Page, xRatio: number, yRatio: number): Promise<CssExtraction | null> {
  return await page.evaluate(CSS_SCRIPT, { xRatio, yRatio })
}

/** Render an extraction as a copy-paste-friendly CSS block. */
export function renderCssBlock(extraction: CssExtraction): string {
  const lines = [`/* ${extraction.tag}${extraction.id !== undefined ? `#${extraction.id}` : ''} — ${extraction.text || 'no text'} */`, `${extraction.selector} {`]
  for (const [key, value] of Object.entries(extraction.styles)) {
    lines.push(`  ${key}: ${value};`)
  }
  lines.push('}')
  return lines.join('\n')
}
