// Persistent browser filesystems for browser-claude-sdk.
//
// - DexieFileSystem (recommended): IndexedDB-backed, durable, queryable, with
//   metadata + power-user methods. Optional peer dependency `dexie`.
// - OpfsFileSystem: Origin Private File System; native hierarchical handles,
//   best for large binary files.
// - seedLinuxTree: lay down a standard Linux FHS skeleton.

export {
  DexieFileSystem,
  type FsNode,
  type DexieFileSystemOptions,
} from './dexie.js'
export { OpfsFileSystem, type OpfsFileSystemOptions } from './opfs.js'
export { seedLinuxTree, LINUX_DIRS, DEFAULT_HOME } from './linuxTree.js'
// In-memory FileSystem (great for tests) — surfaced here alongside the
// persistent backends for discoverability; it physically lives in workspace/.
export { MemoryFileSystem } from '../workspace/memory.js'
