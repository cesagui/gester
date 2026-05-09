import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { streamCompletions } from './claude.js';

const app = new Hono();

app.use('/*', cors({ origin: 'http://localhost:5173' }));

app.get('/health', (c) => c.json({ ok: true }));

app.post('/complete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const buffer = typeof body.buffer === 'string' ? body.buffer : '';
  const context = Array.isArray(body.context) ? body.context : [];

  return streamSSE(c, async (stream) => {
    try {
      for await (const delta of streamCompletions({ buffer, context })) {
        await stream.writeSSE({ data: delta });
      }
      await stream.writeSSE({ event: 'done', data: '' });
    } catch (err) {
      await stream.writeSSE({
        event: 'error',
        data: String(err?.message ?? err),
      });
    }
  });
});

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port });
console.log(`jester backend listening on http://localhost:${port}`);
