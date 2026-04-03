export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  options?: { pollMs?: number; message?: string }
): Promise<void> {
  const pollMs = options?.pollMs ?? 100;
  const message = options?.message ?? `Timed out after ${timeoutMs}ms waiting for condition`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(pollMs);
  }

  throw new Error(message);
}
