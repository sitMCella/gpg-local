import { describe, it, expect } from 'vitest'
import { decryptedOutputPath } from './decryptedOutputPath'

describe('decryptedOutputPath', () => {
  it('strips .gpg from report.md.gpg → report.md', () => {
    expect(decryptedOutputPath('report.md.gpg')).toBe('report.md')
  })

  it('strips .pgp from archive.pgp → archive', () => {
    expect(decryptedOutputPath('archive.pgp')).toBe('archive')
  })

  it('strips .gpg from photo.jpg.gpg → photo.jpg', () => {
    expect(decryptedOutputPath('photo.jpg.gpg')).toBe('photo.jpg')
  })

  it('appends .decrypted for unrecognised extensions', () => {
    expect(decryptedOutputPath('document.txt')).toBe('document.txt.decrypted')
  })

  it('works with full paths: /home/user/report.md.gpg → /home/user/report.md', () => {
    expect(decryptedOutputPath('/home/user/report.md.gpg')).toBe('/home/user/report.md')
  })

  it('strips .GPG (case-insensitive)', () => {
    expect(decryptedOutputPath('file.txt.GPG')).toBe('file.txt')
  })
})
