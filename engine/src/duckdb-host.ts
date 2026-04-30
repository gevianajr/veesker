import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export class DuckDBHost {
  private constructor(
    private instance: DuckDBInstance,
    private conn: DuckDBConnection,
    private closed = false,
  ) {}

  static async openInMemory(): Promise<DuckDBHost> {
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    return new DuckDBHost(instance, conn);
  }

  static async openFile(path: string): Promise<DuckDBHost> {
    const instance = await DuckDBInstance.create(path);
    const conn = await instance.connect();
    return new DuckDBHost(instance, conn);
  }

  async exec(sql: string): Promise<void> {
    if (this.closed) throw new Error("DuckDBHost is closed");
    await this.conn.run(sql);
  }

  async query(sql: string): Promise<Record<string, unknown>[]> {
    if (this.closed) throw new Error("DuckDBHost is closed");
    const reader = await this.conn.runAndReadAll(sql);
    return reader.getRowObjects();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.conn.disconnectSync();
    this.instance.closeSync();
  }
}
