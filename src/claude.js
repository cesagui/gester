import Anthropic from '@anthropic-ai/sdk';
import { COMPLETION_SYSTEM_PROMPT } from './prompts.js';

const client = new Anthropic();

export async function* streamCompletions({ buffer, context }) {
  const stream = client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 80,
    temperature: 0.2,
    system: [
      {
        type: 'text',
        text: COMPLETION_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: buildUserMessage(buffer, context) },
    ],
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta'
    ) {
      yield event.delta.text;
    }
  }
}

function buildUserMessage(buffer, context) {
  const recent = context?.length ? `Recent text: ${context.join(' ')}\n` : '';
  return `${recent}Current buffer: "${buffer ?? ''}"`;
}
