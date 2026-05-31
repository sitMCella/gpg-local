import '@testing-library/jest-dom'
import { vi } from 'vitest'

// react-resizable-panels uses ResizeObserver internally
vi.stubGlobal('ResizeObserver', class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
})

// @base-ui/react ScrollArea uses getAnimations which jsdom doesn't implement
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => []
}
