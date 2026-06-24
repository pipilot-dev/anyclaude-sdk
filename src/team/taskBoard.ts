// In-memory task board shared across the coordinator and its workers. Tasks
// carry ownership, status, and dependency edges (blocks / blockedBy) so the
// coordinator can decompose work and gate execution on prerequisites.

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export type BoardTask = {
  id: string
  subject: string
  description?: string
  owner?: string
  status: TaskStatus
  /** Tasks that depend on this one. */
  blocks: string[]
  /** Tasks that must complete before this one can start. */
  blockedBy: string[]
  createdAt: number
  updatedAt: number
}

export class TaskBoard {
  private tasks = new Map<string, BoardTask>()
  private counter = 0

  create(input: {
    subject: string
    description?: string
    owner?: string
    blockedBy?: string[]
  }): BoardTask {
    const now = Date.now()
    const id = `task_${++this.counter}`
    const task: BoardTask = {
      id,
      subject: input.subject,
      description: input.description,
      owner: input.owner,
      status: 'pending',
      blocks: [],
      blockedBy: input.blockedBy ? [...input.blockedBy] : [],
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(id, task)
    // Maintain the reverse edge on prerequisites.
    for (const dep of task.blockedBy) {
      const d = this.tasks.get(dep)
      if (d && !d.blocks.includes(id)) d.blocks.push(id)
    }
    return task
  }

  update(
    id: string,
    patch: Partial<{
      subject: string
      description: string
      owner: string
      status: TaskStatus
      blocks: string[]
      blockedBy: string[]
    }>
  ): BoardTask | null {
    const t = this.tasks.get(id)
    if (!t) return null
    Object.assign(t, patch)
    t.updatedAt = Date.now()
    return t
  }

  get(id: string): BoardTask | null {
    return this.tasks.get(id) ?? null
  }

  list(filter?: { status?: TaskStatus; owner?: string }): BoardTask[] {
    let out = [...this.tasks.values()]
    if (filter?.status) out = out.filter((t) => t.status === filter.status)
    if (filter?.owner) out = out.filter((t) => t.owner === filter.owner)
    return out
  }

  /** Atomically claim an unowned/pending task. Null if already claimed. */
  claim(id: string, owner: string): BoardTask | null {
    const t = this.tasks.get(id)
    if (!t) return null
    if (t.owner || t.status !== 'pending') return null
    t.owner = owner
    t.status = 'in_progress'
    t.updatedAt = Date.now()
    return t
  }

  /** True if any prerequisite is not yet completed. */
  isBlocked(id: string): boolean {
    const t = this.tasks.get(id)
    if (!t) return false
    return t.blockedBy.some((dep) => {
      const d = this.tasks.get(dep)
      return !d || d.status !== 'completed'
    })
  }
}
