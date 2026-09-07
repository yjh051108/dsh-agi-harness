/**
 * Atomic page actions: execute a model-chosen primitive against an element
 * addressed by snapshot index. Indexes are re-issued by every snapshot; a
 * stale index fails with the current snapshot so the model retries from
 * evidence instead of guessing.
 * @module @dsh-external/dsh-browser-panel/actions
 */

import type { Page } from 'playwright-core'
import { collectSnapshot } from './snapshot.ts'

/** Failure carrying the fresh snapshot so callers can retry from evidence. */
export class StaleIndexError extends Error {
  constructor(public readonly snapshotText: string) {
    super(`element index is stale; snapshot re-issued:\n${snapshotText}`)
    this.name = 'StaleIndexError'
  }
}

/** Locate the element backing a snapshot index, or throw {@link StaleIndexError}. */
async function elementByIndex(page: Page, index: number, maxItems: number): Promise<{ xpath: string; name: string }> {
  const snapshot = await collectSnapshot(page, maxItems)
  const target = snapshot.elements.find(element => element.index === index)
  if (target === undefined) throw new StaleIndexError(renderForRetry(snapshot))
  return { xpath: target.xpath, name: target.name }
}

/** Compact retry hint: URL plus the numbered inventory lines only. */
function renderForRetry(snapshot: { url: string; title: string; elements: readonly { index: number; role: string; name: string }[] }): string {
  const lines = [`URL: ${snapshot.url}`, `Title: ${snapshot.title}`, '']
  for (const element of snapshot.elements) lines.push(`[${element.index}] ${element.role}: ${element.name}`)
  return lines.join('\n')
}

/** Click the element at `index`. */
export async function click(page: Page, index: number, maxItems: number): Promise<void> {
  const { xpath } = await elementByIndex(page, index, maxItems)
  await page.locator(`xpath=${xpath}`).first().click({ timeout: 10_000 })
}

/**
 * Fill the element at `index` with text. `replace: true` clears first; false
 * appends, which works for both controlled (React/Vue) and plain inputs.
 */
export async function typeText(page: Page, index: number, text: string, replace: boolean, maxItems: number): Promise<void> {
  const { xpath } = await elementByIndex(page, index, maxItems)
  const locator = page.locator(`xpath=${xpath}`).first()
  if (replace) {
    await locator.fill(text, { timeout: 10_000 })
  } else {
    await locator.pressSequentially(text, { delay: 8 })
  }
}

/** Press a keyboard key on the element at `index` (Enter, Tab, Escape, …). */
export async function press(page: Page, index: number, key: string, maxItems: number): Promise<void> {
  const { xpath } = await elementByIndex(page, index, maxItems)
  await page.locator(`xpath=${xpath}`).first().press(key, { timeout: 10_000 })
}

/** Scroll the viewport or bring the element at `index` into view. */
export async function scroll(page: Page, index: number | undefined, direction: 'up' | 'down' | 'top' | 'bottom' | undefined, maxItems: number): Promise<void> {
  if (index !== undefined) {
    const { xpath } = await elementByIndex(page, index, maxItems)
    await page.locator(`xpath=${xpath}`).first().scrollIntoViewIfNeeded({ timeout: 10_000 })
    return
  }
  const delta = direction === 'up' ? -600 : direction === 'down' ? 600 : 0
  await page.evaluate(({ delta, direction }) => {
    if (direction === 'top') window.scrollTo(0, 0)
    else if (direction === 'bottom') window.scrollTo(0, document.body.scrollHeight)
    else window.scrollBy(0, delta)
  }, { delta, direction: direction ?? 'down' })
}

/** Wait for the page to settle (network idle plus a short stability pause). */
export async function waitStable(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(300)
}
