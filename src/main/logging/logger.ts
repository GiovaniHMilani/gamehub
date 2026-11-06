import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Structured JSON-lines logging with redaction (docs/architecture §18).
 * Cookies, tokens and credentials must never reach a log (CLAUDE.md §10).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogRecord {
  readonly ts: string
  readonly level: LogLevel
  readonly scope: string
  readonly event: string
  readonly [field: string]: unknown
}

export interface LogSink {
  write(record: LogRecord): void
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
  child(scope: string): Logger
}

const SENSITIVE_KEY = /cookie|token|authorization|password|secret|credential/i

/** Keeps origin + path only: queries and hashes often carry OAuth tokens. */
export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '[invalid-url]'
  }
}

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]'
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string' && /(^|[a-z])url$/i.test(key)) return sanitizeUrl(value)
  return value
}

export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) out[key] = redactValue(key, value)
  return out
}

export function createLogger(scope: string, sink: LogSink, now: () => Date = () => new Date()): Logger {
  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    // Reserved keys are written last so callers cannot spoof them.
    sink.write({ ...redactFields(fields ?? {}), ts: now().toISOString(), level, scope, event })
  }
  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (childScope) => createLogger(childScope, sink, now),
  }
}

export class MemorySink implements LogSink {
  readonly records: LogRecord[] = []
  write(record: LogRecord): void {
    this.records.push(record)
  }
  events(): string[] {
    return this.records.map((r) => r.event)
  }
}

export function multiSink(...sinks: LogSink[]): LogSink {
  return { write: (record) => sinks.forEach((sink) => sink.write(record)) }
}

export function stderrSink(): LogSink {
  return { write: (record) => process.stderr.write(`${JSON.stringify(record)}\n`) }
}

const MAX_LOG_BYTES = 5 * 1024 * 1024

/** Appends JSON lines to `<dir>/gamehub.log`, rotating once to `.1` at 5 MB. */
export function fileSink(dir: string): LogSink {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'gamehub.log')
  return {
    write(record) {
      try {
        try {
          if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.1`)
        } catch {
          // File does not exist yet.
        }
        appendFileSync(file, `${JSON.stringify(record)}\n`)
      } catch {
        // Logging must never crash the app.
      }
    },
  }
}
