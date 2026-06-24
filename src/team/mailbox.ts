// In-memory inter-agent mailbox, shared across the coordinator and the workers
// it spawns. Each message is addressed to a teammate by name; recipients drain
// their inbox to receive. Browser-safe: no timers/fs; ids are monotonic.

export type AgentMessage = {
  id: string
  from: string
  to: string
  text: string
  ts: number
  read: boolean
}

export class Mailbox {
  private messages: AgentMessage[] = []
  private counter = 0

  /** Deliver a message; returns the message id. */
  send(from: string, to: string, text: string): string {
    const id = `msg_${++this.counter}`
    this.messages.push({ id, from, to, text, ts: Date.now(), read: false })
    return id
  }

  /** Messages addressed to `agentId`, oldest first. */
  inbox(agentId: string, opts?: { unreadOnly?: boolean }): AgentMessage[] {
    return this.messages.filter(
      (m) => m.to === agentId && (!opts?.unreadOnly || !m.read)
    )
  }

  /** Mark every message addressed to `agentId` as read. */
  markRead(agentId: string): void {
    for (const m of this.messages) if (m.to === agentId) m.read = true
  }

  /** Send the same text to several recipients; returns the ids. */
  broadcast(from: string, text: string, recipients: string[]): string[] {
    return recipients.map((to) => this.send(from, to, text))
  }

  /** Every message, in send order. */
  all(): AgentMessage[] {
    return [...this.messages]
  }
}
