export function maybeThrow(): void {
  try {
    throw new Error("x");
  } catch (e) {
    void e;
  }
}
