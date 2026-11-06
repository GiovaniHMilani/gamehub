import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Metadata only (ADR-0003). Cookies, storage, cache and auth state belong to
 * the Electron partition and must never be added here.
 */

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startUrl: text('start_url').notNull(),
  description: text('description').notNull().default(''),
  /** JSON array of origin patterns (see shared/domain/origin-pattern.ts). */
  allowedOrigins: text('allowed_origins', { mode: 'json' }).$type<string[]>().notNull().default([]),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const gameAccounts = sqliteTable(
  'game_accounts',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    /** Immutable; names the Chromium partition. UNIQUE = no two accounts share a session. */
    partitionId: text('partition_id').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('game_accounts_game_id_idx').on(table.gameId)],
)

export const gameInstances = sqliteTable('game_instances', {
  id: text('id').primaryKey(),
  /** UNIQUE: an account has at most one instance (ADR-0002). */
  accountId: text('account_id')
    .notNull()
    .unique()
    .references(() => gameAccounts.id, { onDelete: 'cascade' }),
  restoreOnLaunch: integer('restore_on_launch', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** Pending physical deletions of partition directories (ADR-0008). */
export const partitionTombstones = sqliteTable('partition_tombstones', {
  partitionId: text('partition_id').primaryKey(),
  requestedAt: integer('requested_at').notNull(),
})
