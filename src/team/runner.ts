// Teammate idle-loop: auto-claim pending, unblocked tasks from the shared board
// and execute them via worker sub-agents, respecting dependencies. Loops until
// nothing is claimable (all done, or remaining tasks blocked by failed
// prerequisites), a max-iteration cap, or an abort.

import type { BoardTask, TaskBoard } from './taskBoard.js'

export type SpawnWorker = (task: BoardTask) => Promise<{ text: string; isError?: boolean }>

export interface TeamLoopOptions {
  /** Max tasks executed in parallel per round. Default 3. */
  concurrency?: number
  /** Safety cap on rounds (each round runs one parallel batch). Default 25. */
  maxIterations?: number
  /** Owner label recorded when claiming. Default 'worker'. */
  worker?: string
  signal?: AbortSignal
}

export interface TeamLoopResult {
  completed: string[]
  failed: string[]
  rounds: number
}

export async function runTeamLoop(
  board: TaskBoard,
  spawn: SpawnWorker,
  opts: TeamLoopOptions = {}
): Promise<TeamLoopResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  const maxIterations = opts.maxIterations ?? 25
  const worker = opts.worker || 'worker'
  const signal = opts.signal
  const completed: string[] = []
  const failed: string[] = []
  let rounds = 0

  while (rounds < maxIterations) {
    if (signal?.aborted) break
    // Claimable = pending and not blocked by an incomplete prerequisite.
    const claimable = board.list({ status: 'pending' }).filter((t) => !board.isBlocked(t.id))
    if (!claimable.length) break

    // Atomically claim up to `concurrency` of them for this round.
    const batch: BoardTask[] = []
    for (const t of claimable) {
      if (batch.length >= concurrency) break
      const claimed = board.claim(t.id, worker)
      if (claimed) batch.push(claimed)
    }
    if (!batch.length) break
    rounds++

    await Promise.all(
      batch.map(async (task) => {
        try {
          const res = await spawn(task)
          board.update(task.id, { status: res.isError ? 'failed' : 'completed' })
          ;(res.isError ? failed : completed).push(task.id)
        } catch {
          board.update(task.id, { status: 'failed' })
          failed.push(task.id)
        }
      })
    )
  }

  return { completed, failed, rounds }
}
