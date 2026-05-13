declare module 'node:crypto' {
  export function randomUUID(): string;
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: 'hex'): string };
  };
  export function scryptSync(password: string, salt: string, keylen: number): Buffer;
  export function timingSafeEqual(a: Buffer, b: Buffer): boolean;
}
declare module 'node:http' {
  export function createServer(
    handler: (
      req: {
        method?: string;
        url?: string;
        headers: Record<string, string | string[] | undefined>;
      },
      res: {
        setHeader(name: string, value: string): void;
        statusCode: number;
        end(body?: string): void;
      },
    ) => void,
  ): { listen(port: number, cb: () => void): void };
}
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
declare const Buffer: {
  from(input: string, encoding?: string): { toString(encoding?: string): string };
};
declare const process: { env: Record<string, string | undefined> };
declare const console: { log(message?: unknown): void };
