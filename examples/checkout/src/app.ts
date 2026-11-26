import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Pool } from 'pg';
import type { placeOrder } from './fixed.js';

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sample checkout</title>
<link rel="icon" href="data:,"><script src="/checkout.js" defer></script></head>
<body><h1>Sample checkout</h1>
<p>Sample kit • $12.00</p><button data-testid="add-product">Add sample kit</button>
<form hidden><label>Order label <input data-testid="order-label" maxlength="48"></label>
<button data-testid="place-order">Place order</button></form>
<p data-testid="confirmation" role="status" hidden>Checkout complete</p>
<p data-testid="checkout-error" role="alert" hidden>Checkout could not complete</p>
</body></html>`;

const script = `const testId = (id) => document.querySelector('[data-testid="' + id + '"]');
const form = document.querySelector('form');
testId('add-product').addEventListener('click', () => {
  form.hidden = false;
  testId('add-product').disabled = true;
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  testId('place-order').disabled = true;
  try {
    const quote = await fetch('https://shipping.repro.test/quote');
    if (!quote.ok) throw new Error();
    const { cents } = await quote.json();
    const response = await fetch('/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: 'sample-kit', label: testId('order-label').value, cents })
    });
    if (!response.ok) throw new Error();
    testId('confirmation').hidden = false;
  } catch {
    testId('checkout-error').hidden = false;
  }
});`;

export async function startApp(pool: Pool, order: typeof placeOrder) {
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET') {
      if (request.url === '/health') return response.end('ok');
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self' https://shipping.repro.test; img-src data:; form-action 'none'");
        return response.end(html);
      }
      if (request.url === '/checkout.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        return response.end(script);
      }
    }
    if (request.method !== 'POST' || request.url !== '/checkout') {
      response.statusCode = 404;
      return response.end();
    }

    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 512) throw new Error();
      }
      const data = JSON.parse(body);
      if (data?.sku !== 'sample-kit' || data.label !== 'Sample label' || data.cents !== 250) {
        response.statusCode = 400;
        return response.end();
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT price_cents FROM products WHERE sku = $1', [data.sku]);
        if (!rows[0]) throw new Error();
        await order(client, data.sku, data.label, rows[0].price_cents + data.cents);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      response.statusCode = 201;
      return response.end();
    } catch {
      response.statusCode = 500;
      return response.end();
    }
  });
  server.listen(3000, '127.0.0.1');
  await once(server, 'listening');
  return async () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
