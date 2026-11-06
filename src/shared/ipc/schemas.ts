import { z } from 'zod'
import { parseGameUrl } from '../domain/game-url'
import { parseOriginPattern } from '../domain/origin-pattern'
import { MAX_STAGE_SLOTS, type StageLayoutInput } from '../domain/stage-layout'
import type { CreateGameInput, CreateInstanceInput, GameRef, InstanceRef, ResolveNoticeInput, SetAllowedOriginsInput, UpdateGameInput } from '../domain/types'

/**
 * Main-side validation schemas, one per input-carrying channel.
 * `.strict()` rejects unknown keys. Never imported by the preload.
 */

const allowedOriginsField = z
  .array(z.string().max(255).refine((value) => parseOriginPattern(value) !== null, { message: 'Invalid origin pattern' }))
  .max(20)

export const createGameSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    startUrl: z
      .string()
      .max(2048)
      .refine((value) => parseGameUrl(value).ok, { message: 'Invalid game URL' }),
    description: z.string().trim().max(200).optional(),
    allowedOrigins: allowedOriginsField.optional(),
  })
  .strict() satisfies z.ZodType<CreateGameInput>

export const setAllowedOriginsSchema = z
  .object({ gameId: z.uuid(), allowedOrigins: allowedOriginsField })
  .strict() satisfies z.ZodType<SetAllowedOriginsInput>

export const createInstanceSchema = z
  .object({
    gameId: z.uuid(),
    label: z.string().trim().min(1).max(60),
  })
  .strict() satisfies z.ZodType<CreateInstanceInput>

/** The editable fields of a game, all of them: this replaces name, address and description. */
export const updateGameSchema = z
  .object({
    gameId: z.uuid(),
    name: z.string().trim().min(1).max(100),
    startUrl: z
      .string()
      .max(2048)
      .refine((value) => parseGameUrl(value).ok, { message: 'Invalid game URL' }),
    description: z.string().trim().max(200),
  })
  .strict() satisfies z.ZodType<UpdateGameInput>

export const gameRefSchema = z.object({ gameId: z.uuid() }).strict() satisfies z.ZodType<GameRef>

export const instanceRefSchema = z.object({ instanceId: z.uuid() }).strict() satisfies z.ZodType<InstanceRef>

export const resolveNoticeSchema = z
  .object({ noticeId: z.uuid(), decision: z.enum(['allow', 'dismiss']) })
  .strict() satisfies z.ZodType<ResolveNoticeInput>

const coordinate = z.number().int().min(0).max(20_000)
const extent = z.number().int().min(1).max(20_000)

/** One-way layout request: where each running instance's view should be shown (ADR-0017). */
export const stageLayoutSchema = z
  .object({
    slots: z
      .array(z.object({ instanceId: z.uuid(), x: coordinate, y: coordinate, width: extent, height: extent }).strict())
      .max(MAX_STAGE_SLOTS),
  })
  .strict() satisfies z.ZodType<StageLayoutInput>
