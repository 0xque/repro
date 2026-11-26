import type { PoolClient } from 'pg';

export async function placeOrder(client: PoolClient, sku: string, label: string, cents: number) {
  const statement = 'INSERT INTO orders (sku, label, total_cents) VALUES ($1, $2, $3)';
  await client.query(statement, [sku, label, cents]);
  await client.query(statement, [sku, label, cents]);
}
