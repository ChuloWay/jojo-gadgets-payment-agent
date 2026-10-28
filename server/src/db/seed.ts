import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createPool } from './pool.js';

const seedRows = [
  ['MBA-M2-256-UK', 'MacBook Air M2', 'laptop', 'uk_used', '256GB', 115_000_000, 2],
  ['PS5-DISC-NEW', 'PlayStation 5 Disc Edition', 'console', 'new', '825GB', 78_000_000, 1],
  ['IP13-128-UK', 'iPhone 13', 'phone', 'uk_used', '128GB', 52_000_000, 3],
  ['IP15P-256-NEW', 'iPhone 15 Pro', 'phone', 'new', '256GB', 165_000_000, 1],
  ['S23-256-NEW', 'Samsung Galaxy S23', 'phone', 'new', '256GB', 85_000_000, 2],
  ['XPS13-512-REF', 'Dell XPS 13', 'laptop', 'refurbished', '512GB', 69_000_000, 1]
] as const;

export async function ensureSeeded(connectionString: string): Promise<void> {
  const pool = createPool(connectionString);
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const row of seedRows) {
      const result = await client.query(
        `INSERT INTO skus
          (sku, name, category, condition, variant, price_kobo, qty_available)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (sku) DO NOTHING`,
        [...row]
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query('COMMIT');
    process.stdout.write(`Ensured demo inventory; inserted ${inserted} missing SKUs\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function seed(connectionString: string): Promise<void> {
  const pool = createPool(connectionString);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE paystack_webhook_events, owner_alerts, payment_events, orders, quotes, skus RESTART IDENTITY CASCADE');
    for (const row of seedRows) {
      await client.query(
        `INSERT INTO skus
          (sku, name, category, condition, variant, price_kobo, qty_available)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [...row]
      );
    }
    await client.query('COMMIT');
    process.stdout.write(`Seeded ${seedRows.length} SKUs\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await seed(loadConfig().databaseUrl);
}
