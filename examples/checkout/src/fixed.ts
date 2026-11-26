import type { PoolClient } from 'pg';

export async function placeOrder(client: PoolClient, sku: string, label: string, cents: number) {
  await client.query('INSERT INTO orders (sku, label, total_cents) VALUES ($1, $2, $3)', [sku, label, cents]);
}
