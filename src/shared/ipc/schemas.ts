import { z } from 'zod'
import { parseGameUrl } from '../domain/game-url'
import type { CreateGameInput, CreateInstanceInput, InstanceRef } from '../domain/types'

/**
 * Main-side validation schemas, one per input-carrying channel.
 * `.strict()` rejects unknown keys. Never imported by the preload.
 */

export const createGameSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    startUrl: z
      .string()
      .max(2048)
      .refine((value) => parseGameUrl(value).ok, { message: 'Invalid game URL' }),
  })
  .strict() satisfies z.ZodType<CreateGameInput>

export const createInstanceSchema = z
  .object({
    gameId: z.uuid(),
    label: z.string().trim().min(1).max(60),
  })
  .strict() satisfies z.ZodType<CreateInstanceInput>

export const instanceRefSchema = z.object({ instanceId: z.uuid() }).strict() satisfies z.ZodType<InstanceRef>
