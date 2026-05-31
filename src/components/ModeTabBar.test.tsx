import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import ModeTabBar from './ModeTabBar'

describe('ModeTabBar', () => {
  it('renders an Encrypt tab and a Decrypt tab', () => {
    render(<ModeTabBar mode="encrypt" onModeChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: /encrypt/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /decrypt/i })).toBeInTheDocument()
  })

  it('marks the active tab as selected', () => {
    render(<ModeTabBar mode="encrypt" onModeChange={vi.fn()} />)

    const encryptTab = screen.getByRole('tab', { name: /encrypt/i })
    expect(encryptTab).toHaveAttribute('aria-selected', 'true')

    const decryptTab = screen.getByRole('tab', { name: /decrypt/i })
    expect(decryptTab).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onModeChange with "decrypt" when the Decrypt tab is clicked', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<ModeTabBar mode="encrypt" onModeChange={onModeChange} />)

    await user.click(screen.getByRole('tab', { name: /decrypt/i }))

    expect(onModeChange).toHaveBeenCalledWith('decrypt')
  })

  it('calls onModeChange with "encrypt" when the Encrypt tab is clicked', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<ModeTabBar mode="decrypt" onModeChange={onModeChange} />)

    await user.click(screen.getByRole('tab', { name: /encrypt/i }))

    expect(onModeChange).toHaveBeenCalledWith('encrypt')
  })
})
