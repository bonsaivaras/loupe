import type { Renderer } from './renderer'

let current: Renderer | null = null

export function setActiveRenderer(renderer: Renderer | null): void {
  current = renderer
}

export function getActiveRenderer(): Renderer | null {
  return current
}
