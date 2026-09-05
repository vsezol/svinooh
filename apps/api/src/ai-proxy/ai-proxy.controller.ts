import { Body, Controller, HttpException, Post, UseGuards } from '@nestjs/common';
import { RequiredAuthGuard } from '@svinooh/common';
import { config } from '../config';

/**
 * The api gateway does not run the AI agent — it forwards /ai/* to the agent
 * service (internal HTTP), the same way auth-proxy forwards /auth/*. The agent
 * is a separate microservice (Python / FastAPI + LangChain) and never faces the
 * public: only the gateway reaches it, over Railway's private network.
 *
 * Gated by RequiredAuthGuard: a chat turn spends real LLM tokens, so only a
 * signed-in owner may trigger one.
 */
async function forward(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${config.agentServiceUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // A model turn is slow by nature — give it room, but not forever.
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) throw new HttpException(data as Record<string, unknown>, res.status);
  return data;
}

@Controller('ai')
export class AiProxyController {
  @Post('chat')
  @UseGuards(RequiredAuthGuard)
  chat(@Body() body: { message?: string; session_id?: string }) {
    // Cap the prompt here rather than trust the client — the agent bills per token.
    const message = String(body?.message ?? '').slice(0, 4000);
    // The session id is the agent's conversation-memory handle; pass it through
    // untouched so context survives the hop through this gateway.
    const session_id = typeof body?.session_id === 'string' ? body.session_id.slice(0, 64) : undefined;
    return forward('/chat', { message, session_id });
  }
}
