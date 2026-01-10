import { EventEmitter } from 'node:events';
import * as pg from 'pg';

declare class Db extends EventEmitter {
  pool: pg.Pool;

  /**
   * @param config - Configuration options
   * @param config.pool - Connection pool instance to use
   * @param config.poolOptions - Connection pool configuration
   */
  constructor(config?: {
    pool?: pg.Pool;
    poolOptions?: pg.PoolConfig;
  });

  /**
   * Prepare statement spec for execution.
   */
  convertSpec(spec: Record<string, any>): {
    spec: Record<string, any>;
    statement: string;
    values: any[];
  };

  /**
   * Execute a statement.
   */
  exec(
    statementOrSpec: string | Record<string, any>,
    valuesOrCtx?: any[] | Record<string, any>,
    ctx?: Record<string, any>
  ): Promise<pg.QueryResult>;

  /**
   * Execute a function with multiple queries under a single transaction.
   */
  transact<T>(
    f: (ctx: Record<string, any>) => Promise<T>,
    ctx?: Record<string, any>
  ): Promise<T>;
}

export default Db;

