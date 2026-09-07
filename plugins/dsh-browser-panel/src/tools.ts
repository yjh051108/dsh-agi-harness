/**
 * Model-facing browser tools over the per-session headed browser. The whole
 * surface is text-only by design (DeepSeek models have no vision):
 * `browser_snapshot` renders the page as structured text with a numbered
 * interactive inventory, and every other tool addresses elements by that
 * inventory's index. Screenshots never enter model context.
 *
 * The tool contracts below are self-declared minimal interfaces (this plugin
 * is a standalone repo with no SDK dependency; the host Harness provides the
 * real services at runtime).
 * @module @dsh-external/dsh-browser-panel/tools
 */

import { BrowserSession, PROFILE_ROOT } from './browser.ts'
import { collectSnapshot, diffSnapshot } from './snapshot.ts'
import type { PageSnapshot } from './protocol.ts'
import { renderSnapshot } from './protocol.ts'
import { click, press, scroll, typeText, waitStable } from './actions.ts'
import { describeFrame, type VisionOptions } from './vision.ts'

/** Minimal tool contract the host `tools` registry provides (subset). */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: Record<string, unknown>, value: unknown): unknown
  }
  execute(args: Record<string, unknown>, exec: ToolExecution): Promise<unknown>
}

/** Minimal execution context the tool registry supplies. */
export interface ToolExecution {
  readonly signal: AbortSignal
  readonly agent?: { readonly sessionId?: string }
}

/** Minimal Cordis context carrying the tools service. */
export interface ToolsContext {
  tools: {
    register(tool: ToolDefinition): () => void
  }
}

/** Per-session browser ownership: one BrowserSession per owner session id. */
export class BrowserSessionRegistry {
  private readonly sessions = new Map<string, BrowserSession>()

  /** The browser owned by `sessionId`, creating it on first use. */
  get(sessionId: string): BrowserSession {
    let session = this.sessions.get(sessionId)
    if (session === undefined) {
      session = new BrowserSession()
      this.sessions.set(sessionId, session)
    }
    return session
  }

  /** Number of sessions whose browser is currently open. */
  openCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.isOpen) count += 1
    }
    return count
  }

  /** Close every session idle longer than `idleMs`; returns how many closed. */
  async closeIdle(idleMs: number): Promise<number> {
    let closed = 0
    const candidates: BrowserSession[] = []
    for (const session of this.sessions.values()) {
      if (session.isOpen && session.idleMs() > idleMs) candidates.push(session)
    }
    await Promise.all(candidates.map(async (session) => {
      await session.close()
      closed += 1
    }))
    return closed
  }

  /** Close and forget every owned session. */
  async dispose(): Promise<void> {
    const all = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(all.map(session => session.close()))
  }
}
/** Budgets resolved from plugin config before tool registration. */
export interface BrowserToolsOptions {
  readonly toolTimeoutMs: number
  readonly snapshotMaxChars: number
  readonly maxInteractiveItems: number
  /** Optional vision bridge; enables `browser_vision` when set. */
  readonly vision?: VisionOptions
}

/** Canonical result: one text payload. */
interface TextResult {
  text: string
}

/** Output contract shared by every browser tool. */
const TEXT_OUTPUT: ToolDefinition['output'] = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: (value as TextResult).text }],
}

/** Explicit JSON Schema object root: empty parameter objects get serialized as
 * `{ type: null }` by the DeepSeek adapter and rejected (400), so every tool
 * declares `type: 'object'` explicitly. */
const OBJECT_SCHEMA = { type: 'object' as const, additionalProperties: false as const }

/** Owner session id for one tool execution. */
function ownerSessionId(exec: ToolExecution): string {
  return exec.agent?.sessionId ?? 'default'
}

/** Sanitize a session id into a safe profile directory name. */
function profileDirFor(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${PROFILE_ROOT}/${safe}`
}

/**
 * Register the browser tools on `ctx.tools`, all backed by one registry.
 * @param ctx - Cordis context with the tools service.
 * @param registry - the shared per-session browser registry.
 * @param options - resolved tool budgets.
 */
export function registerBrowserTools(ctx: ToolsContext, registry: BrowserSessionRegistry, options: BrowserToolsOptions): void {
  for (const tool of defineTools(registry, options)) ctx.tools.register(tool)
}

/** Define the full tool set; model-perspective contracts only. */
function defineTools(registry: BrowserSessionRegistry, options: BrowserToolsOptions): ToolDefinition[] {
  /** Last full snapshot per owner session, for delta mode. */
  const lastSnapshots = new Map<string, PageSnapshot>()
  const sessionFor = async (exec: ToolExecution): Promise<BrowserSession> => {
    const sessionId = ownerSessionId(exec)
    const session = registry.get(sessionId)
    if (!session.isOpen) await session.open(profileDirFor(sessionId))
    session.touch()
    return session
  }
  const snapshotText = async (session: BrowserSession, exec: ToolExecution, delta: boolean): Promise<string> => {
    const sessionId = ownerSessionId(exec)
    const snapshot = await collectSnapshot(session.page!, options.maxInteractiveItems)
    if (delta) {
      const previous = lastSnapshots.get(sessionId)
      lastSnapshots.set(sessionId, snapshot)
      if (previous === undefined) return renderSnapshot(snapshot, options.snapshotMaxChars)
      return diffSnapshot(previous, snapshot)
    }
    lastSnapshots.set(sessionId, snapshot)
    return renderSnapshot(snapshot, options.snapshotMaxChars)
  }

  return [
    {
      name: 'browser_open',
      description: 'Open the browser for this conversation (idempotent). Returns the current page URL and title, or "new tab" state.',
      parameters: OBJECT_SCHEMA,
      output: TEXT_OUTPUT,
      async execute(_args, exec) {
        const session = await sessionFor(exec)
        return { text: session.page === undefined ? 'Browser opened (new tab).' : `Browser ready: ${session.url}` }
      },
    },
    {
      name: 'browser_navigate',
      description: 'Navigate the browser to an absolute http(s) URL and wait for the page to load.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { url: { type: 'string', description: 'Absolute http(s) URL' } },
        required: ['url'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        await session.navigate(args.url as string)
        return { text: `Navigated to ${session.url}` }
      },
    },
    {
      name: 'browser_snapshot',
      description: 'Read the current page as a numbered interactive inventory (non-multimodal observation). Elements are addressed by [index] in other tools. delta=true returns only what changed since the last snapshot (cheap; first call returns the full inventory). Use after every action that may change the page.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { delta: { type: 'boolean', description: 'Only output changes since the last snapshot; defaults to false' } },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        return { text: await snapshotText(session, exec, args.delta === true) }
      },
    },
    {
      name: 'browser_click',
      description: 'Click the element at [index] from the latest snapshot. Stale indexes return a fresh snapshot; retry from it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { index: { type: 'number', description: 'Element index from the latest snapshot' } },
        required: ['index'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        try {
          await click(session.page!, args.index as number, options.maxInteractiveItems)
          await waitStable(session.page!)
        } catch (error) {
          return { text: error instanceof Error ? `Click failed: ${error.message}` : 'Click failed.' }
        }
        return { text: `Clicked [${args.index}].\n${await snapshotText(session, exec, false)}` }
      },
    },
    {
      name: 'browser_type',
      description: 'Type text into the element at [index]. replace=true clears first; replace=false appends (works for controlled inputs).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'number', description: 'Element index from the latest snapshot' },
          text: { type: 'string', description: 'Text to enter' },
          replace: { type: 'boolean', description: 'Clear before typing; defaults to false' },
        },
        required: ['index', 'text'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        try {
          await typeText(session.page!, args.index as number, args.text as string, args.replace === true, options.maxInteractiveItems)
        } catch (error) {
          return { text: error instanceof Error ? `Type failed: ${error.message}` : 'Type failed.' }
        }
        return { text: `Typed into [${args.index}].\n${await snapshotText(session, exec, false)}` }
      },
    },
    {
      name: 'browser_press',
      description: 'Press a keyboard key on the element at [index]: Enter, Tab, Escape, ArrowUp, ArrowDown, Backspace, etc.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'number', description: 'Element index from the latest snapshot' },
          key: { type: 'string', description: 'Key name, e.g. Enter / Tab / Escape / ArrowDown' },
        },
        required: ['index', 'key'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        try {
          await press(session.page!, args.index as number, args.key as string, options.maxInteractiveItems)
        } catch (error) {
          return { text: error instanceof Error ? `Press failed: ${error.message}` : 'Press failed.' }
        }
        return { text: `Pressed ${args.key} on [${args.index}].\n${await snapshotText(session, exec, false)}` }
      },
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the viewport (direction: up/down/top/bottom) or bring the element at [index] into view.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'number', description: 'Element index to reveal; omit to scroll the viewport' },
          direction: { type: 'string', description: 'up | down | top | bottom; default down' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        await scroll(session.page!, args.index as number | undefined, args.direction as 'up' | 'down' | 'top' | 'bottom' | undefined, options.maxInteractiveItems)
        return { text: await snapshotText(session, exec, false) }
      },
    },
    {
      name: 'browser_wait',
      description: 'Wait for the page to settle (network idle + stability pause). Use before snapshotting after heavy interactions.',
      parameters: OBJECT_SCHEMA,
      output: TEXT_OUTPUT,
      async execute(_args, exec) {
        const session = await sessionFor(exec)
        await waitStable(session.page!)
        return { text: 'Page settled.' }
      },
    },
    {
      name: 'browser_eval',
      description: 'Run a JavaScript expression in the page and return its JSON value. Advanced; prefer dedicated tools. Result capped at 4000 characters.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { expression: { type: 'string', description: 'JavaScript expression; must be JSON-serializable' } },
        required: ['expression'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        const value = await session.page!.evaluate(args.expression as string)
        const text = JSON.stringify(value, null, 2)
        return { text: text.length > 4000 ? `${text.slice(0, 4000)}… (truncated)` : text }
      },
    },
    ...(['back', 'forward', 'reload'] as const).map((action): ToolDefinition => ({
      name: `browser_${action}`,
      description: `Navigate ${action} in the browser history${action === 'reload' ? ' (reload the current page)' : ''}.`,
      parameters: OBJECT_SCHEMA,
      output: TEXT_OUTPUT,
      async execute(_args, exec) {
        const session = await sessionFor(exec)
        const page = session.page!
        if (action === 'back') await page.goBack({ waitUntil: 'load', timeout: 30_000 }).catch(() => null)
        else if (action === 'forward') await page.goForward({ waitUntil: 'load', timeout: 30_000 }).catch(() => null)
        else await page.reload({ waitUntil: 'load', timeout: 30_000 })
        await waitStable(page)
        return { text: `${action} done.\n${await snapshotText(session, exec, false)}` }
      },
    })),
    {
      name: 'browser_new_tab',
      description: 'Open a new tab and activate it (about:blank). Use before navigating to a fresh page.',
      parameters: OBJECT_SCHEMA,
      output: TEXT_OUTPUT,
      async execute(_args, exec) {
        const session = await sessionFor(exec)
        await session.newTab()
        return { text: 'New tab opened.' }
      },
    },
    {
      name: 'browser_tabs',
      description: 'List the open tabs (index, URL, active flag).',
      parameters: OBJECT_SCHEMA,
      output: TEXT_OUTPUT,
      async execute(_args, exec) {
        const session = await sessionFor(exec)
        const lines = session.tabs.map(tab => `[${tab.index}] ${tab.active ? '*' : ' '} ${tab.url}`)
        return { text: lines.length === 0 ? 'No tabs.' : lines.join('\n') }
      },
    },
    {
      name: 'browser_switch',
      description: 'Activate the tab at [index] (0-based, from browser_tabs).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { index: { type: 'number', description: 'Tab index from browser_tabs (0-based)' } },
        required: ['index'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        try {
          await session.switchTab(args.index as number)
        } catch (error) {
          return { text: error instanceof Error ? `Switch failed: ${error.message}` : 'Switch failed.' }
        }
        return { text: `Switched to tab [${args.index}].\n${await snapshotText(session, exec, false)}` }
      },
    },
    {
      name: 'browser_close_tab',
      description: 'Close the tab at [index] (0-based). The last tab cannot be closed; use browser_close to end the session.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { index: { type: 'number', description: 'Tab index from browser_tabs (0-based)' } },
        required: ['index'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        try {
          await session.closeTab(args.index as number)
        } catch (error) {
          return { text: error instanceof Error ? `Close failed: ${error.message}` : 'Close failed.' }
        }
        return { text: `Tab [${args.index}] closed.` }
      },
    },
    {
      name: 'browser_close',
      description: 'Close the browser for this conversation and free its resources. Idempotent.',
      parameters: OBJECT_SCHEMA,
      output: TEXT_OUTPUT,
      async execute(_args, exec) {
        const session = registry.get(ownerSessionId(exec))
        await session.close()
        return { text: 'Browser closed.' }
      },
    },
    {
      name: 'browser_wait_selector',
      description: 'Wait until an element matching a CSS selector appears, disappears, or is visible on the current page. Use before snapshotting after navigation or async UI updates.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for, e.g. "button[data-testid=\\"submit\\"]"' },
          state: { type: 'string', description: 'attached | detached | visible | hidden; defaults to visible' },
          timeoutMs: { type: 'number', description: 'Max wait in ms; defaults to 10000' },
        },
        required: ['selector'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        const selector = args.selector as string
        const state = (args.state as string | undefined) ?? 'visible'
        const timeoutMs = (args.timeoutMs as number | undefined) ?? 10_000
        const states = ['attached', 'detached', 'visible', 'hidden']
        if (!states.includes(state)) return { text: `Invalid state "${state}"; expected ${states.join(' | ')}.` }
        try {
          await session.page!.waitForSelector(selector, { state: state as 'attached' | 'detached' | 'visible' | 'hidden', timeout: timeoutMs })
          return { text: `Selector "${selector}" ${state}.` }
        } catch (error) {
          return { text: error instanceof Error ? `Wait failed: ${error.message}` : 'Wait failed.' }
        }
      },
    },
    {
      name: 'browser_console',
      description: 'Read recent console messages from the current page (errors, warnings, info, debug). Useful for diagnosing page failures. Optionally clear=false to keep the buffer; use clear=true to reset after reading.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          clear: { type: 'boolean', description: 'Clear the console buffer after reading; defaults to true' },
          limit: { type: 'number', description: 'Max messages to return; defaults to 50' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        const limit = Math.max(1, Math.min(200, (args.limit as number | undefined) ?? 50))
        const entries = session.consoleLog.slice(-limit).reverse()
        if (entries.length === 0) return { text: 'No console messages recorded.' }
        const lines = entries.map(entry => `[${entry.type}] ${entry.url}\n  ${entry.text}`)
        if (args.clear === true) session.clearConsole()
        return { text: lines.join('\n') }
      },
    },
    {
      name: 'browser_dialogs',
      description: 'List pending page dialogs (alert/confirm/prompt) waiting for a decision. Respond with browser_dialog_respond.',
      parameters: OBJECT_SCHEMA,
      output: TEXT_OUTPUT,
      async execute(_args, exec) {
        const session = await sessionFor(exec)
        const dialogs = session.pendingDialogs
        if (dialogs.length === 0) return { text: 'No pending dialogs.' }
        const lines = dialogs.map(dialog => `[${dialog.id}] ${dialog.type}: ${dialog.message}`)
        return { text: lines.join('\n') }
      },
    },
    {
      name: 'browser_dialog_respond',
      description: 'Respond to a pending dialog from browser_dialogs: accept (optionally with text for prompt) or dismiss.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'number', description: 'Dialog id from browser_dialogs' },
          accept: { type: 'boolean', description: 'true = accept/OK; false = dismiss/Cancel; defaults to true' },
          text: { type: 'string', description: 'Text to submit for prompt dialogs' },
        },
        required: ['id'],
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        const id = args.id as number
        const accept = args.accept !== false
        try {
          await session.respondDialog(id, accept, args.text as string | undefined)
          return { text: `Dialog [${id}] ${accept ? 'accepted' : 'dismissed'}.` }
        } catch (error) {
          return { text: error instanceof Error ? `Respond failed: ${error.message}` : 'Respond failed.' }
        }
      },
    },
    {
      name: 'browser_downloads',
      description: 'List files downloaded by the current page (most recent first), with local paths when available.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { limit: { type: 'number', description: 'Max downloads to list; defaults to 10' } },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        const limit = Math.max(1, Math.min(50, (args.limit as number | undefined) ?? 10))
        const downloads = session.downloadList.slice(0, limit)
        if (downloads.length === 0) return { text: 'No downloads recorded.' }
        const lines = downloads.map(item => `[${item.id}] ${item.filename}${item.path === undefined ? '' : ` → ${item.path}`}`)
        return { text: lines.join('\n') }
      },
    },
    ...(options.vision === undefined ? [] : [{
      name: 'browser_vision',
      description: 'Ask the configured vision model to describe the current page frame (opt-in bridge; the page screenshot enters the model context for this call only).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', description: 'What to ask about the page; defaults to a general description' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const session = await sessionFor(exec)
        const prompt = (args.prompt as string | undefined) ?? 'Describe what is visible on this web page, including the page purpose and key UI elements.'
        try {
          const text = await describeFrame(session.page!, options.vision!, prompt)
          return { text }
        } catch (error) {
          return { text: error instanceof Error ? `Vision failed: ${error.message}` : 'Vision failed.' }
        }
      },
    } satisfies ToolDefinition]),
  ]
}
