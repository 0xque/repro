import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import type { postgresFixture } from '../../schema/src/index.js';

const exec = promisify(execFile);

export async function startDatabase(fixture: typeof postgresFixture) {
  const root = await mkdtemp('/tmp/repro-db-');
  const data = join(root, 'data');
  const socket = join(root, 'socket');
  const database = 'checkout';
  const bin = '/usr/lib/postgresql/16/bin';
  const pgctl = join(bin, 'pg_ctl');
  const options = { timeout: 12_000 };
  await mkdir(socket, { mode: 0o700 });
  await exec(join(bin, 'initdb'), ['-D', data, '-U', 'pwuser', '--auth-local=peer', '--auth-host=reject', '--no-locale'], options);
  await writeFile(join(data, 'pg_hba.conf'), 'local all pwuser peer\nlocal checkout checkout_app,checkout_oracle scram-sha-256\n');
  await exec(pgctl, ['-D', data, '-l', join(root, 'postgres.log'), '-o', "-h '' -k " + socket, '-w', '-t', '8', 'start'], options);

  const config = { host: socket, connectionTimeoutMillis: 3_000, statement_timeout: 3_000, max: 2 };
  const admin = new Pool({ ...config, database: 'postgres', user: 'pwuser' });
  const appPassword = randomBytes(24).toString('hex');
  const oraclePassword = randomBytes(24).toString('hex');
  try {
    await admin.query('CREATE DATABASE checkout');
    await admin.query(`CREATE ROLE checkout_app LOGIN PASSWORD '${appPassword}';
      CREATE ROLE checkout_oracle LOGIN PASSWORD '${oraclePassword}'`);
  } finally {
    await admin.end();
  }

  const owner = new Pool({ ...config, database, user: 'pwuser' });
  try {
    await owner.query(`REVOKE ALL ON DATABASE checkout FROM PUBLIC;
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      CREATE TABLE products (sku text PRIMARY KEY, price_cents integer NOT NULL);
      CREATE TABLE orders (sku text NOT NULL REFERENCES products(sku), label text NOT NULL,
        total_cents integer NOT NULL);
      GRANT CONNECT ON DATABASE checkout TO checkout_app, checkout_oracle;
      GRANT USAGE ON SCHEMA public TO checkout_app, checkout_oracle;
      GRANT SELECT ON products TO checkout_app;
      GRANT INSERT ON orders TO checkout_app;
      GRANT SELECT ON orders TO checkout_oracle`);
    await owner.query('INSERT INTO products VALUES ($1, $2)', [fixture.product.sku, fixture.product.price_cents]);
  } finally {
    await owner.end();
  }

  const app = new Pool({ ...config, database, user: 'checkout_app', password: appPassword });
  const oracle = new Pool({ ...config, database, user: 'checkout_oracle', password: oraclePassword });
  try {
    const seeded = await app.query('SELECT price_cents FROM products WHERE sku = $1', [fixture.product.sku]);
    const initial = await oracle.query('SELECT count(*)::integer AS count FROM orders');
    if (seeded.rows[0]?.price_cents !== fixture.product.price_cents || initial.rows[0]?.count !== 0) {
      throw new Error('Fixture verification failed');
    }
    const privileges = await oracle.query("SELECT has_table_privilege(current_user, 'orders', 'INSERT') AS writes");
    if (privileges.rows[0]?.writes !== false) throw new Error('Oracle role can write orders');
  } catch {
    await Promise.allSettled([app.end(), oracle.end()]);
    throw new Error('Database fixture setup failed');
  }
  return {
    app,
    async count() {
      const { rows } = await oracle.query('SELECT count(*)::integer AS count FROM orders');
      const count: unknown = rows[0]?.count;
      if (typeof count !== 'number') throw new Error('Oracle query returned invalid data');
      return count;
    },
    async close() {
      await Promise.all([app.end(), oracle.end()]);
      await exec(pgctl, ['-D', data, '-m', 'fast', '-w', '-t', '8', 'stop'], options);
    }
  };
}
