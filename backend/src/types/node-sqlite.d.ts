// Type declarations for the Node.js built-in `node:sqlite` module
// (Added in Node.js v22.5.0 — not yet in @types/node)

declare module 'node:sqlite' {
  interface DatabaseSyncOptions {
    /** Allow unknown column types to be returned. Default: false */
    allowUnknownTypes?: boolean;
    /** Open the database in read-only mode. Default: false */
    readOnly?: boolean;
    /** Enable WAL mode. Default: false */
    enableWAL?: boolean;
  }

  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface StatementSync {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    /** Iterates over result rows */
    iterate(...params: unknown[]): IterableIterator<unknown>;
    /** Return result as an array of arrays instead of objects */
    setAllowBareNamedParameters(enabled: boolean): void;
    setReadBigInts(enabled: boolean): void;
  }

  class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
    readonly open: boolean;
  }
}
