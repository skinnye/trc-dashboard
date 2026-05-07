import sql from 'mssql';
import { SQL_CONFIG } from './config';

let _pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (_pool?.connected) return _pool;
  if (_pool) await _pool.close().catch(() => {});
  _pool = await new sql.ConnectionPool(SQL_CONFIG as any).connect();
  _pool.on('error', () => { _pool = null; });
  return _pool;
}

export { sql };
