// Rate-limit windows are aligned to the clock (a 60 s window starts on every whole minute). A test that
// sends "limit + 1" requests must not straddle a boundary, or the extra request lands in a fresh window
// and is allowed. If too little of the current window is left, wait for the next one to begin.
export async function waitForFreshRateLimitWindow(
  windowSeconds: number,
  neededMilliseconds = 10_000,
): Promise<void> {
  const windowMilliseconds = windowSeconds * 1_000;
  const remainingMilliseconds = windowMilliseconds - (Date.now() % windowMilliseconds);
  if (remainingMilliseconds < neededMilliseconds) {
    await new Promise((resolve) => setTimeout(resolve, remainingMilliseconds + 50));
  }
}
