import MediaWorker from './media.worker?worker'
import type { MediaRequest, MediaRequestInput, MediaResponse } from './decodeTypes'

interface Pending {
  resolve: (value: MediaResponse) => void
  reject: (reason: Error) => void
}

/** Round-robin pool of pixel workers; each request is independent. */
class MediaPool {
  private workers: Worker[] = []
  private pending = new Map<number, Pending>()
  private nextId = 1
  private cursor = 0
  private readonly size: number

  constructor() {
    this.size = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency ?? 4) / 2)))
  }

  private ensure(): void {
    if (this.workers.length > 0) return
    for (let i = 0; i < this.size; i += 1) {
      const worker = new MediaWorker()
      worker.onmessage = (event: MessageEvent<MediaResponse>) => {
        const entry = this.pending.get(event.data.id)
        if (!entry) return
        this.pending.delete(event.data.id)
        entry.resolve(event.data)
      }
      worker.onerror = (event) => {
        const message = event.message || 'Media worker crashed'
        for (const [, entry] of this.pending) entry.reject(new Error(message))
        this.pending.clear()
      }
      this.workers.push(worker)
    }
  }

  run<T extends MediaResponse>(
    request: MediaRequestInput,
    transfer: Transferable[] = [],
  ): Promise<T> {
    this.ensure()
    const id = this.nextId++
    const worker = this.workers[this.cursor % this.workers.length]
    this.cursor += 1
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => {
          if (value.ok) resolve(value as T)
          else reject(new Error(value.error))
        },
        reject,
      })
      worker.postMessage({ ...request, id } as MediaRequest, transfer)
    })
  }

  terminate(): void {
    for (const worker of this.workers) worker.terminate()
    this.workers = []
    for (const [, entry] of this.pending) entry.reject(new Error('Cancelled'))
    this.pending.clear()
  }
}

export const mediaPool = new MediaPool()
