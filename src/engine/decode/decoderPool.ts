import { decodeWithLibRaw, LibRaw } from './rawDecoder'
import type { RawDecodeResult } from './decodeTypes'

const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1))

/** Bound wasm heap growth: each instance is disposed and rebuilt periodically. */
const MAX_DECODES_PER_INSTANCE = 25

interface Slot {
  raw: LibRaw | null
  uses: number
  busy: boolean
  /** Set while a decode is in flight so cancellation can dispose the instance. */
  taskId: string | null
}

interface Task {
  id: string
  buffer: ArrayBuffer
  mode: 'proxy' | 'full'
  priority: boolean
  resolve: (value: RawDecodeResult) => void
  reject: (reason: Error) => void
}

export class CancelledError extends Error {
  constructor() {
    super('Decode cancelled')
    this.name = 'CancelledError'
  }
}

class DecoderPool {
  private slots: Slot[] = []
  private queue: Task[] = []
  /** Photo id that should jump the queue — the one the user is looking at. */
  private priorityId: string | null = null
  /** Reuse across files is verified at runtime; a failure falls back to fresh instances. */
  private reuseInstances = true

  private ensureSlots(): void {
    while (this.slots.length < POOL_SIZE) {
      this.slots.push({ raw: null, uses: 0, busy: false, taskId: null })
    }
  }

  setPriority(photoId: string | null): void {
    this.priorityId = photoId
    // Re-sort so the newly selected photo is dispatched next.
    if (photoId) {
      const index = this.queue.findIndex((t) => t.id === photoId)
      if (index > 0) {
        const [task] = this.queue.splice(index, 1)
        task.priority = true
        this.queue.unshift(task)
      }
    }
  }

  decode(id: string, buffer: ArrayBuffer, mode: 'proxy' | 'full'): Promise<RawDecodeResult> {
    this.ensureSlots()
    return new Promise<RawDecodeResult>((resolve, reject) => {
      const task: Task = { id, buffer, mode, priority: id === this.priorityId, resolve, reject }
      if (task.priority) this.queue.unshift(task)
      else this.queue.push(task)
      this.pump()
    })
  }

  /** Removes queued work; disposes the instance if the decode already started. */
  cancel(id: string): void {
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.queue[i].id === id) {
        this.queue[i].reject(new CancelledError())
        this.queue.splice(i, 1)
      }
    }
    for (const slot of this.slots) {
      if (slot.taskId === id) this.recycle(slot)
    }
  }

  cancelAll(): void {
    for (const task of this.queue) task.reject(new CancelledError())
    this.queue = []
    for (const slot of this.slots) {
      if (slot.busy) this.recycle(slot)
    }
  }

  /** `dispose()` is the only abort: there is no way to interrupt a decode mid-wasm. */
  private recycle(slot: Slot): void {
    try {
      slot.raw?.dispose()
    } catch {
      /* already gone */
    }
    slot.raw = null
    slot.uses = 0
    slot.taskId = null
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy || this.queue.length === 0) continue
      const task = this.queue.shift()
      if (!task) return
      void this.run(slot, task)
    }
  }

  private async run(slot: Slot, task: Task): Promise<void> {
    slot.busy = true
    slot.taskId = task.id
    try {
      const result = await this.attempt(slot, task)
      if (slot.taskId === task.id) task.resolve(result)
      else task.reject(new CancelledError())
    } catch (error) {
      // A failed decode can leave the wasm heap in an unknown state.
      this.recycle(slot)
      task.reject(
        error instanceof Error ? error : new Error(String(error)),
      )
    } finally {
      slot.busy = false
      slot.taskId = null
      if (slot.raw && slot.uses >= MAX_DECODES_PER_INSTANCE) this.recycle(slot)
      this.pump()
    }
  }

  private async attempt(slot: Slot, task: Task): Promise<RawDecodeResult> {
    if (!slot.raw || !this.reuseInstances) {
      if (slot.raw) this.recycle(slot)
      slot.raw = new LibRaw()
      slot.uses = 0
    }
    slot.uses += 1
    const reused = slot.uses > 1
    try {
      return await decodeWithLibRaw(slot.raw, task.buffer, task.mode)
    } catch (error) {
      // Distinguish "this file is bad" from "this instance cannot be reused".
      if (!reused) throw error
      this.recycle(slot)
      slot.raw = new LibRaw()
      slot.uses = 1
      const result = await decodeWithLibRaw(slot.raw, task.buffer, task.mode)
      // Reuse produced a spurious failure — stop reusing for the rest of the session.
      this.reuseInstances = false
      console.warn('[loupe] LibRaw instance reuse disabled after a retry succeeded')
      return result
    }
  }

  dispose(): void {
    this.cancelAll()
    for (const slot of this.slots) this.recycle(slot)
    this.slots = []
  }
}

export const decoderPool = new DecoderPool()
export { POOL_SIZE }
