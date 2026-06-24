// Daytona sandbox adapter.
//
// Wrap a Daytona `Sandbox` (from `@daytonaio/sdk`):
//
//   import { Daytona } from '@daytonaio/sdk'
//   const daytona = new Daytona()
//   const sbx = await daytona.create()
//   const workspace = new DaytonaSandbox(sbx)
//
// Methods used:
//   sbx.fs.uploadFile(content: Uint8Array, destPath)   // some SDK versions: (destPath, content)
//   sbx.fs.downloadFile(path) -> Uint8Array
//   sbx.fs.listFiles(path) -> FileInfo[] { name, isDir }
//   sbx.fs.deleteFile(path)
//   sbx.fs.createFolder(path, mode?)
//   sbx.process.executeCommand(command, cwd?, env?, timeout?) -> { exitCode, result | artifacts.stdout }

import type { CommandExecutor, FileSystem } from '../types/index.js'
import type { Sandbox } from './types.js'
import { resolvePath } from '../util/paths.js'

interface DaytonaFileInfo {
  name: string
  isDir?: boolean
  isDirectory?: boolean
}

interface DaytonaExecResult {
  exitCode?: number
  result?: string
  artifacts?: { stdout?: string }
}

export interface DaytonaClientLike {
  fs: {
    uploadFile(content: Uint8Array, destPath: string): Promise<unknown>
    downloadFile(path: string): Promise<Uint8Array | ArrayBuffer | string>
    listFiles(path: string): Promise<DaytonaFileInfo[]>
    deleteFile(path: string): Promise<unknown>
    createFolder(path: string, mode?: string): Promise<unknown>
  }
  process: {
    executeCommand(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number
    ): Promise<DaytonaExecResult>
  }
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export class DaytonaSandbox implements Sandbox, FileSystem, CommandExecutor {
  readonly cwd: string
  constructor(private readonly client: DaytonaClientLike, cwd = '/home/daytona') {
    this.cwd = cwd
  }

  private r(p: string): string {
    return resolvePath(this.cwd, p)
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    try {
      const data = await this.client.fs.downloadFile(this.r(path))
      if (data instanceof Uint8Array) return data
      if (data instanceof ArrayBuffer) return new Uint8Array(data)
      if (typeof data === 'string') return encoder.encode(data)
      return null
    } catch {
      return null
    }
  }

  async readFile(path: string): Promise<string | null> {
    const bytes = await this.readBinary(path)
    return bytes === null ? null : decoder.decode(bytes)
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    await this.client.fs.uploadFile(data, this.r(path))
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await this.writeBinary(path, encoder.encode(contents))
  }

  async deleteFile(path: string): Promise<void> {
    await this.client.fs.deleteFile(this.r(path))
  }

  async readdir(path: string): Promise<Array<{ name: string; isDir: boolean }> | null> {
    try {
      const entries = await this.client.fs.listFiles(this.r(path))
      return entries.map((e) => ({
        name: e.name,
        isDir: e.isDir ?? e.isDirectory ?? false,
      }))
    } catch {
      return null
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.client.fs.createFolder(this.r(path), '755')
  }

  async exec(
    command: string,
    timeoutMs?: number,
    env?: Record<string, string>
  ): Promise<{ output: string; exitCode: number }> {
    const res = await this.client.process.executeCommand(
      command,
      this.cwd,
      env,
      timeoutMs != null ? Math.ceil(timeoutMs / 1000) : undefined
    )
    const out = res.result ?? res.artifacts?.stdout ?? ''
    return { output: out.trimEnd(), exitCode: res.exitCode ?? 0 }
  }
}

export function createDaytonaSandbox(client: DaytonaClientLike, cwd?: string): DaytonaSandbox {
  return new DaytonaSandbox(client, cwd)
}
