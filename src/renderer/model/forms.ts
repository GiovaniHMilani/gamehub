import { parseGameUrl } from '@shared/domain/game-url'
import { parseOriginPattern } from '@shared/domain/origin-pattern'
import { gameHost } from './game-identity'

/**
 * Form validation for immediate, friendly feedback. It is NOT a security boundary: Main
 * validates every request again (zod schemas, ADR-0005) and may refuse what this accepts.
 */
export const MAX_GAME_NAME = 100
export const MAX_DESCRIPTION = 200
export const MAX_ACCOUNT_LABEL = 60
export const MAX_ORIGINS = 20

export interface GameFormInput {
  readonly name: string
  readonly url: string
  readonly description: string
}

export interface GameFormErrors {
  readonly name?: string
  readonly url?: string
  readonly description?: string
}

/** The name to use when the user left it empty: the game's host, which is what they typed. */
export function suggestedGameName(url: string): string {
  const parsed = parseGameUrl(url.trim())
  return parsed.ok ? gameHost(parsed.url.href).replace(/^www\./, '') : ''
}

export function validateGameForm(input: GameFormInput): GameFormErrors {
  const errors: { name?: string; url?: string; description?: string } = {}
  const url = input.url.trim()

  if (url === '') {
    errors.url = 'Enter the address of the game.'
  } else {
    const parsed = parseGameUrl(url)
    if (!parsed.ok) {
      errors.url = /https/.test(parsed.reason)
        ? 'Use an https address. Plain http only works for localhost.'
        : /credentials/.test(parsed.reason)
          ? "The address can't contain a user name or password."
          : 'Enter a full address, like https://example.com/'
    }
  }

  const name = input.name.trim()
  if (name.length > MAX_GAME_NAME) errors.name = `Keep the name under ${MAX_GAME_NAME} characters.`
  if (name === '' && suggestedGameName(url) === '' && errors.url === undefined) errors.name = 'Give the game a name.'

  if (input.description.trim().length > MAX_DESCRIPTION) errors.description = `Keep the description under ${MAX_DESCRIPTION} characters.`
  return errors
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0
}

/** `Account 3`, the first number that is free in this game. Never empty, never a duplicate. */
export function suggestedAccountLabel(existingLabels: readonly string[]): string {
  const taken = new Set(existingLabels.map((label) => label.trim().toLocaleLowerCase()))
  for (let n = existingLabels.length + 1; ; n++) {
    const candidate = `Account ${n}`
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate
  }
}

/** Two accounts of one game must be easy to tell apart, so a repeated name is refused here. */
export function validateAccountLabel(label: string, existingLabels: readonly string[]): string | null {
  const trimmed = label.trim()
  if (trimmed === '') return 'Give the account a name, like "Main" or "Alt 2".'
  if (trimmed.length > MAX_ACCOUNT_LABEL) return `Keep the name under ${MAX_ACCOUNT_LABEL} characters.`
  const duplicate = existingLabels.some((existing) => existing.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase())
  return duplicate ? 'This game already has an account with that name.' : null
}

/**
 * The canonical form of an address the user typed: trimmed, host and scheme in lower case, no
 * trailing slash. What is sent to Main is this value, because Main only accepts the canonical form.
 * Anything that is not an origin is returned as typed, so validation can explain what is wrong.
 */
export function normalizeOrigin(input: string): string {
  const value = input.trim()
  if (/^https:\/\/\*\./i.test(value)) return value.toLowerCase().replace(/\/$/, '') // a wildcard
  try {
    const url = new URL(value)
    const originOnly = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === ''
    if (originOnly && (url.protocol === 'https:' || url.protocol === 'http:')) return url.origin
  } catch {
    // not a URL: fall through
  }
  return value
}

export function validateOrigin(input: string, existing: readonly string[]): string | null {
  const value = normalizeOrigin(input)
  if (value === '') return 'Enter an address, like https://login.example.com'
  if (parseOriginPattern(value) === null) {
    return 'Use just the site, like https://login.example.com (https only), or https://*.example.com for all its subdomains.'
  }
  if (existing.some((origin) => origin.toLocaleLowerCase() === value.toLocaleLowerCase())) return 'That address is already allowed.'
  if (existing.length >= MAX_ORIGINS) return `A game can have at most ${MAX_ORIGINS} extra addresses.`
  return null
}

export type AddressChange = 'none' | 'page' | 'site'

/**
 * How an edited address differs from the saved one, to warn the user before saving:
 *  - none: the same address (a trailing slash does not count);
 *  - page: same site, another path or query. Accounts keep their logins;
 *  - site: another origin. Cookies and storage belong to a site, so accounts may need to sign in again.
 * An address that does not parse counts as `none`: the form's own validation reports it.
 */
export function describeAddressChange(savedUrl: string, editedUrl: string): AddressChange {
  let saved: URL
  let edited: URL
  try {
    saved = new URL(savedUrl.trim())
    edited = new URL(editedUrl.trim())
  } catch {
    return 'none'
  }
  if (saved.href === edited.href) return 'none'
  return saved.origin === edited.origin ? 'page' : 'site'
}
