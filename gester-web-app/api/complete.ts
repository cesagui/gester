import Anthropic from '@anthropic-ai/sdk';

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are a word-completion engine for an assistive typing device. The user types via arm gestures and cannot use a regular keyboard, so every saved keystroke matters.

Given the user's current text buffer, return up to 5 likely completions or next-word suggestions.

Rules:
- Output one completion per line, plain text only.
- No numbering, no bullets, no quotes, no commentary, no trailing punctuation.
- If the buffer ends mid-word, complete the current word.
- If the buffer ends with whitespace, suggest likely next words or short phrases.
- Order by likelihood, most likely first.
- Prefer common, useful, contextually fitting words.
- Stop after 5 lines. Do not say anything else.`;

const client = new Anthropic();

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const buffer = typeof (body as { buffer?: unknown }).buffer === 'string' ? (body as { buffer: string }).buffer : '';
  const rawCtx = (body as { context?: unknown }).context;
  const context = Array.isArray(rawCtx) ? rawCtx.filter((s): s is string => typeof s === 'string') : [];

  const userMessage = `${context.length ? `Recent text: ${context.join(' ')}\n` : ''}Current buffer: "${buffer}"`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const aiStream = client.messages.stream({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 80,
          temperature: 0.2,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: userMessage }],
        });

        for await (const event of aiStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta?.type === 'text_delta'
          ) {
            const text = event.delta.text;
            // Embedded newlines need their own data: line per SSE spec.
            const dataLines = text.split('\n').map((l) => `data: ${l}`).join('\n');
            controller.enqueue(encoder.encode(`${dataLines}\n\n`));
          }
        }
        controller.enqueue(encoder.encode(`event: done\ndata: \n\n`));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`event: error\ndata: ${msg}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
