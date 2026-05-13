declare module 'node:test' {
  const test: (name: string, fn: () => unknown | Promise<unknown>) => void;
  export default test;
}
declare module 'node:assert/strict' {
  const assert: {
    equal(actual: unknown, expected: unknown): void;
    deepEqual(actual: unknown, expected: unknown): void;
  };
  export default assert;
}
