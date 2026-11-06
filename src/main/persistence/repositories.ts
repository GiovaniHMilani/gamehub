import { eq } from 'drizzle-orm'
import type { Game, GameAccount, GameInstance } from '@shared/domain/types'
import type { Db } from './db'
import { gameAccounts, gameInstances, games, partitionTombstones } from './schema'

/** Joined view used by the InstanceManager. */
export interface InstanceRecord {
  readonly instance: GameInstance
  readonly account: GameAccount
  readonly game: Game
}

export interface NewAccountIds {
  readonly accountId: string
  readonly instanceId: string
  readonly partitionId: string
}

export class GameRepository {
  constructor(private readonly db: Db) {}

  create(game: Omit<Game, 'createdAt' | 'updatedAt'>, now: number): Game {
    const row = { ...game, createdAt: now, updatedAt: now }
    this.db.insert(games).values(row).run()
    return row
  }

  get(id: string): Game | undefined {
    return this.db.select().from(games).where(eq(games.id, id)).get()
  }

  list(): Game[] {
    return this.db.select().from(games).all()
  }
}

export class InstanceRepository {
  constructor(private readonly db: Db) {}

  /**
   * One transaction: the account (with its immutable partitionId) and its
   * instance exist together or not at all.
   */
  createAccountWithInstance(
    input: { gameId: string; label: string; restoreOnLaunch: boolean } & NewAccountIds,
    now: number,
  ): InstanceRecord {
    return this.db.transaction((tx) => {
      const game = tx.select().from(games).where(eq(games.id, input.gameId)).get()
      if (game === undefined) throw new Error('Game not found')
      const account: GameAccount = {
        id: input.accountId,
        gameId: input.gameId,
        label: input.label,
        partitionId: input.partitionId,
        createdAt: now,
        updatedAt: now,
      }
      const instance: GameInstance = {
        id: input.instanceId,
        accountId: input.accountId,
        restoreOnLaunch: input.restoreOnLaunch,
        createdAt: now,
        updatedAt: now,
      }
      tx.insert(gameAccounts).values(account).run()
      tx.insert(gameInstances).values(instance).run()
      return { instance, account, game }
    })
  }

  getRecord(instanceId: string): InstanceRecord | undefined {
    const row = this.db
      .select()
      .from(gameInstances)
      .innerJoin(gameAccounts, eq(gameInstances.accountId, gameAccounts.id))
      .innerJoin(games, eq(gameAccounts.gameId, games.id))
      .where(eq(gameInstances.id, instanceId))
      .get()
    return row === undefined
      ? undefined
      : { instance: row.game_instances, account: row.game_accounts, game: row.games }
  }

  listRecords(): InstanceRecord[] {
    return this.db
      .select()
      .from(gameInstances)
      .innerJoin(gameAccounts, eq(gameInstances.accountId, gameAccounts.id))
      .innerJoin(games, eq(gameAccounts.gameId, games.id))
      .all()
      .map((row) => ({ instance: row.game_instances, account: row.game_accounts, game: row.games }))
  }

  getPartitionId(accountId: string): string | undefined {
    return this.db
      .select({ partitionId: gameAccounts.partitionId })
      .from(gameAccounts)
      .where(eq(gameAccounts.id, accountId))
      .get()?.partitionId
  }

  setRestoreOnLaunch(instanceId: string, value: boolean, now: number): void {
    this.db
      .update(gameInstances)
      .set({ restoreOnLaunch: value, updatedAt: now })
      .where(eq(gameInstances.id, instanceId))
      .run()
  }

  /**
   * One transaction: delete the account (the instance cascades) and record a
   * tombstone so the partition directory is removed even if we crash before
   * the physical deletion (ADR-0008).
   */
  removeAccount(accountId: string, partitionId: string, now: number): void {
    this.db.transaction((tx) => {
      tx.delete(gameAccounts).where(eq(gameAccounts.id, accountId)).run()
      tx.insert(partitionTombstones).values({ partitionId, requestedAt: now }).onConflictDoNothing().run()
    })
  }
}

export class TombstoneRepository {
  constructor(private readonly db: Db) {}

  list(): string[] {
    return this.db.select().from(partitionTombstones).all().map((row) => row.partitionId)
  }

  delete(partitionId: string): void {
    this.db.delete(partitionTombstones).where(eq(partitionTombstones.partitionId, partitionId)).run()
  }
}

export interface Repositories {
  readonly games: GameRepository
  readonly instances: InstanceRepository
  readonly tombstones: TombstoneRepository
}

export function createRepositories(db: Db): Repositories {
  return {
    games: new GameRepository(db),
    instances: new InstanceRepository(db),
    tombstones: new TombstoneRepository(db),
  }
}
