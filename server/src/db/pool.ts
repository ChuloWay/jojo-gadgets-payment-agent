import pg from 'pg';

const { Pool } = pg;

export function createPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString, max: 10 });
}

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;
