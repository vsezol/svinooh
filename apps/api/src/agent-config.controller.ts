import { Controller, Get } from '@nestjs/common';
import { option, setting, text } from '@svinooh/common';
import { PRODUCT_FAQ } from '@svinooh/content';
import type { AgentConfigDto } from '@svinooh/shared';

/**
 * How the agent service learns what the admin panel decided.
 *
 * The agent has no database and no shared libraries — by design, it reads this
 * product the way any third-party client would (apps/agent/DESIGN.md) — so the
 * knobs an operator turns reach it the only way anything reaches it: over
 * HTTP. It polls this, briefly caches it, and falls back to its own
 * environment whenever the answer does not arrive.
 *
 * Unauthenticated on purpose. Nothing here is a secret: it is which model
 * answers, how hard it may think, and the sentences already published on the
 * FAQ page — every bit of which a conversation with the agent reveals anyway.
 * Putting a credential on it would buy nothing and cost the agent its
 * independence, which is the one property the whole design is built on.
 */
@Controller('agent')
export class AgentConfigController {
  @Get('config')
  config(): AgentConfigDto {
    return {
      model: text('agent.model'),
      reasoningEffort: option('agent.reasoningEffort'),
      maxTokens: setting('agent.maxTokens'),
      routerModel: text('agent.routerModel'),
      routerReasoningEffort: option('agent.routerReasoningEffort'),
      routerMaxTokens: setting('agent.routerMaxTokens'),
      toolHops: setting('agent.toolHops'),
      contextMaxPositions: setting('agent.contextMaxPositions'),
      providerSort: option('agent.providerSort'),
      routerProviderSort: option('agent.routerProviderSort'),
      tracing: option('agent.tracing'),
      // Copied rather than referenced: the agent has no shared libraries, and
      // this is the channel it already has.
      product: PRODUCT_FAQ.map((entry) => ({ ...entry })),
    };
  }
}
