import pg from "pg";

type QueryResult<T> = [T[]];

const toPostgresSql = (sql: string) => {
  let index = 0;
  return sql.replace(/\\?/g, () => "$" + (++index));
};

class PgCompatConnection {
  constructor(private readonly client: pg.PoolClient) {}
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.client.query(toPostgresSql(sql), params);
    return [result.rows as T[]];
  }
  async execute(sql: string, params: unknown[] = []): Promise<QueryResult<Record<string, unknown>>> {
    const result = await this.client.query(toPostgresSql(sql), params);
    return [result.rows];
  }
  async beginTransaction() { await this.client.query("BEGIN"); }
  async commit() { await this.client.query("COMMIT"); }
  async rollback() { await this.client.query("ROLLBACK"); }
  release() { this.client.release(); }
}

export class PgCompatPool {
  constructor(private readonly pool: pg.Pool) {}
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.pool.query(toPostgresSql(sql), params);
    return [result.rows as T[]];
  }
  async execute(sql: string, params: unknown[] = []): Promise<QueryResult<Record<string, unknown>>> {
    const result = await this.pool.query(toPostgresSql(sql), params);
    return [result.rows];
  }
  async getConnection() {
    const client = await this.pool.connect();
    return new PgCompatConnection(client);
  }
  async end() { await this.pool.end(); }
}

export const createDatabasePool = (databaseUrl: string, connectionLimit: number) => {
  const parsed = new URL(databaseUrl);
  const protocol = parsed.protocol.replace(":", "").toLowerCase();
  if (protocol !== "postgres" && protocol !== "postgresql") {
    throw new Error(`현재 테스트 웹 서비스는 PostgreSQL DATABASE_URL이 필요합니다. 받은 프로토콜: ${protocol}`);
  }
  const sslMode = parsed.searchParams.get("sslmode");
  const ssl = parsed.hostname.endsWith(".render.com") || sslMode === "require" || sslMode === "verify-full"
    ? { rejectUnauthorized: false }
    : undefined;
  return new PgCompatPool(new pg.Pool({ connectionString: databaseUrl, max: connectionLimit, ssl }));
};
