// Optional off-main-thread execution via Comlink. The BackgroundTaskManager
// works fully WITHOUT any of this — use these helpers only when you want a task
// to run inside a Web Worker (or service worker) instead of on the main thread.
//
// Comlink is an optional peer dependency; it is imported lazily so this module
// can sit in the barrel without forcing Comlink to load for callers that never
// use a worker.

/**
 * A generic "run this serializable job" surface a worker can expose. `code`
 * identifies the job (e.g. a registered handler name or a stringified task);
 * `input` is structured-clone-serializable data. Keep it serializable —
 * functions, class instances, and live handles do not cross the worker boundary.
 */
export interface WorkerRunner {
  run(code: string, input: unknown): Promise<unknown>
}

/**
 * Call inside a Web Worker / Service Worker to expose a WorkerRunner to the main
 * thread via Comlink. No-op (with a console warning) if not in a worker scope.
 */
export async function exposeBackgroundWorker(api: WorkerRunner): Promise<void> {
  const inWorkerScope =
    typeof self !== 'undefined' &&
    typeof (globalThis as { document?: unknown }).document === 'undefined'
  if (!inWorkerScope) {
    // eslint-disable-next-line no-console
    console.warn('[background] exposeBackgroundWorker called outside a worker scope; ignoring.')
    return
  }
  const Comlink = await import('comlink')
  Comlink.expose(api)
}

/**
 * Main-thread side: wrap a Worker into a WorkerRunner proxy via Comlink. The
 * returned object's `run` calls execute inside the worker.
 */
export async function wrapWorker(worker: Worker): Promise<WorkerRunner> {
  const Comlink = await import('comlink')
  return Comlink.wrap<WorkerRunner>(worker)
}
