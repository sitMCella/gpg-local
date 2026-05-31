export function decryptedOutputPath(sourcePath: string): string {
  const lower = sourcePath.toLowerCase()
  if (lower.endsWith('.gpg') || lower.endsWith('.pgp')) {
    return sourcePath.slice(0, sourcePath.lastIndexOf('.'))
  }
  return `${sourcePath}.decrypted`
}
