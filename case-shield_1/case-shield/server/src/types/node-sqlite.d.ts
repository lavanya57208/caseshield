// Minimal ambient typing for Node's built-in `node:sqlite` module (stable in
// recent Node 22.x, still marked experimental by Node itself). Declared here
// so this project type-checks even against an @types/node version that
// predates this module, without adding an external dependency.
declare module "node:sqlite" {
  export class StatementSync {
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
  export class DatabaseSync {
    constructor(location: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
