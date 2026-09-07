let sessionVersion = 0;
const listeners = new Set<() => void>();

export function getAuthSessionVersion(): number {
  return sessionVersion;
}

export function invalidateAuthSession(): number {
  sessionVersion += 1;
  for (const listener of listeners) listener();
  return sessionVersion;
}

export function subscribeAuthSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
