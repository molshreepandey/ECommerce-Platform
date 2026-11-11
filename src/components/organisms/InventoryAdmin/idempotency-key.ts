// One Idempotency-Key per distinct change (TD-018, TD-020, TD-021). The keeper lives with the stock view, not
// with a dialog, so closing and reopening a dialog keeps it:
// - sending a change again reuses its key, so a retry after an unconfirmed attempt (network error, 5xx,
//   timeout, 429, or a dialog closed and reopened) can never apply twice;
// - a different change gets its own key, so an edited change is never refused as a reused key, and going
//   back to an earlier change reuses that change's key;
// - a change is forgotten once the server confirms it, so doing the same thing again later is a new change.
// A full page reload starts a new keeper.
export type IdempotencyKeeper = Readonly<{
  keyFor: (payload: unknown) => string;
  forget: (payload: unknown) => void;
}>;

export function createIdempotencyKeeper(
  newKey: () => string = () => crypto.randomUUID(),
): IdempotencyKeeper {
  const keys = new Map<string, string>();
  return {
    keyFor(payload) {
      const text = JSON.stringify(payload);
      const existing = keys.get(text);
      if (existing !== undefined) return existing;
      const key = newKey();
      keys.set(text, key);
      return key;
    },
    forget(payload) {
      keys.delete(JSON.stringify(payload));
    },
  };
}
