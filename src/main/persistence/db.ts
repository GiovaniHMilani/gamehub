import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenedDatabase {
  readonly db: Db
  close(): void
}

/**
 * Opens (creating if needed) the metadata database and applies migrations.
 * `file` may be ':memory:' for tests. WAL + foreign keys are always enabled:
 * the cascade from account to instance depends on them.
 */
export function openDatabase(file: string, migrationsFolder: string): OpenedDatabase {
  const sqlite = new Database(file)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder })
    return { db, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
