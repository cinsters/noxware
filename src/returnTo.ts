const RETURN_TO_KEY = 'noxware.returnTo'

/** Remember where to land after the next successful login/register. */
export function stashReturnTo(path: string) {
  if (path && path.startsWith('/') && !path.startsWith('//')) {
    try {
      sessionStorage.setItem(RETURN_TO_KEY, path)
    } catch {
      /* private mode etc. — ignore */
    }
  }
}

/** Pop the stashed landing spot, if any. */
export function consumeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY)
    sessionStorage.removeItem(RETURN_TO_KEY)
    return value && value.startsWith('/') && !value.startsWith('//') ? value : null
  } catch {
    return null
  }
}
