import { z } from 'zod'
import { parseGameUrl } from '../domain/game-url'
import { parseOriginPattern } from '../domain/origin-pattern'
import type { CreateGameInput, CreateInstanceInput, InstanceRef, ResolveNoticeInput, SetAllowedOriginsInput } from '../domain/types'

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

export const instanceRefSchema = z.object({ instanceId: z.uuid() }).strict() satisfies z.ZodType<InstanceRef>

export const resolveNoticeSchema = z
  .object({ noticeId: z.uuid(), decision: z.enum(['allow', 'dismiss']) })
  .strict() satisfies z.ZodType<ResolveNoticeInput>
