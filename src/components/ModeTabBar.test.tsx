import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import ModeTabBar from './ModeTabBar'

function renderTabBar(props: Parameters<typeof ModeTabBar>[0]) {
  return render(
    <TooltipProvider>
      <ModeTabBar {...props} />
    </TooltipProvider>
  )
}

describe('ModeTabBar', () => {
  it('renders an Encrypt tab and a Decrypt tab', () => {
    renderTabBar({ mode: 'encrypt', onModeChange: vi.fn(), onRefresh: vi.fn() })

    expect(screen.getByRole('tab', { name: /encrypt/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /decrypt/i })).toBeInTheDocument()
  })

  it('marks the active tab as selected', () => {
    renderTabBar({ mode: 'encrypt', onModeChange: vi.fn(), onRefresh: vi.fn() })

    const encryptTab = screen.getByRole('tab', { name: /encrypt/i })
    expect(encryptTab).toHaveAttribute('aria-selected', 'true')

    const decryptTab = screen.getByRole('tab', { name: /decrypt/i })
    expect(decryptTab).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onModeChange with "decrypt" when the Decrypt tab is clicked', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    renderTabBar({ mode: 'encrypt', onModeChange, onRefresh: vi.fn() })

    await user.click(screen.getByRole('tab', { name: /decrypt/i }))

    expect(onModeChange).toHaveBeenCalledWith('decrypt')
  })

  it('calls onModeChange with "encrypt" when the Encrypt tab is clicked', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    renderTabBar({ mode: 'decrypt', onModeChange, onRefresh: vi.fn() })

    await user.click(screen.getByRole('tab', { name: /encrypt/i }))

    expect(onModeChange).toHaveBeenCalledWith('encrypt')
  })

  it('when decrypt mode is active, Decrypt tab has aria-selected=true and Encrypt tab has aria-selected=false', () => {
    renderTabBar({ mode: 'decrypt', onModeChange: vi.fn(), onRefresh: vi.fn() })

    expect(screen.getByRole('tab', { name: /decrypt/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /encrypt/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('renders a Refresh button with aria-label "Refresh current directory"', () => {
    renderTabBar({ mode: 'encrypt', onModeChange: vi.fn(), onRefresh: vi.fn() })

    expect(screen.getByRole('button', { name: /refresh current directory/i })).toBeInTheDocument()
  })

  it('calls onRefresh when the Refresh button is clicked', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    renderTabBar({ mode: 'encrypt', onModeChange: vi.fn(), onRefresh })

    await user.click(screen.getByRole('button', { name: /refresh current directory/i }))

    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('renders the Refresh button after the tab list in the DOM', () => {
    renderTabBar({ mode: 'encrypt', onModeChange: vi.fn(), onRefresh: vi.fn() })

    const tabList = screen.getByRole('tablist')
    const refreshButton = screen.getByRole('button', { name: /refresh current directory/i })
    expect(
      tabList.compareDocumentPosition(refreshButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
