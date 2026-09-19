import { Injectable, Logger } from '@nestjs/common';
import type { ModelChoiceDto } from '@svinooh/shared';

/**
 * What the models we can actually call are able to do.
 *
 * A model id is not a thing an operator can check by reading it. It can be
 * spelled perfectly and name a model that cannot do this job, or name nothing
 * at all — and either way the first sign is production. That is what a list of
 * allowed values would not have helped with: `qwen/qwen3-30b-a3b-instruct-2507`
 * would have been on it, and asking it to think still broke every turn for
 * hours, because it is an instruct model and has no thinking to do.
 *
 * So what is offered is filtered by what the job needs, and what is chosen is
 * checked against what that model can actually do.
 *
 * The aggregator publishes the answer, so we ask it rather than maintaining a
 * copy that goes stale the week somebody ships a model. No key: this is the
 * public catalogue, the same one the pricing page is built from.
 */
const CATALOGUE = 'https://openrouter.ai/api/v1/models';
const TIMEOUT_MS = 8_000;

/**
 * Long enough that opening the panel does not call out to a third party every
 * time, short enough that a model released this morning is offered this
 * afternoon.
 */
const FRESH_MS = 10 * 60 * 1000;

/** How a model id is written in our settings, versus how the catalogue writes it. */
const WIRE = 'openai:';

interface CatalogueEntry {
  id?: unknown;
  name?: unknown;
  supported_parameters?: unknown;
}

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);
  private models: ModelChoiceDto[] = [];
  private fetchedAt = 0;
  private inFlight: Promise<void> | null = null;

  /**
   * Every model this agent could be pointed at, or an empty list.
   *
   * Empty is a real answer and not an error: the catalogue is a convenience the
   * panel degrades without — a text field instead of a menu — and an aggregator
   * having a bad minute must never be the reason an operator cannot change a
   * setting. That is the whole point of a knob you can turn in production.
   */
  async list(): Promise<ModelChoiceDto[]> {
    if (Date.now() - this.fetchedAt < FRESH_MS) return this.models;
    // One fetch even if three requests arrive together, which they do: the
    // panel loads, saves, and re-reads.
    this.inFlight ??= this.refresh().finally(() => (this.inFlight = null));
    await this.inFlight;
    return this.models;
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(CATALOGUE, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = (await res.json()) as { data?: unknown };
      this.models = this.readable(Array.isArray(body.data) ? body.data : []);
      this.fetchedAt = Date.now();
      this.logger.log(`${this.models.length} models can serve this agent`);
    } catch (error) {
      // Keep whatever we had. A stale catalogue still describes these models
      // correctly — what a model can do does not change under one id.
      this.logger.warn(`model catalogue unavailable (${String(error)}) — keeping ${this.models.length}`);
    }
  }

  /**
   * The ones worth offering, said the way our settings say it.
   *
   * Tool support is not a preference here. The agent looks things up to answer
   * — that is the difference between it and a chat window — and it asks for a
   * label in a schema by making the model call a tool, so a model without them
   * cannot do either half of this job.
   *
   * Note this is the aggregator's model-level answer, which is the union over
   * that model's providers. Good enough to decide what to offer; it does not
   * promise every provider of it can, and that gap has bitten us before.
   */
  private readable(entries: unknown[]): ModelChoiceDto[] {
    return entries
      .map((raw) => raw as CatalogueEntry)
      .filter((entry) => typeof entry.id === 'string' && Array.isArray(entry.supported_parameters))
      .map((entry) => ({
        entry,
        parameters: (entry.supported_parameters as unknown[]).map(String),
      }))
      .filter(({ parameters }) => parameters.includes('tools'))
      .map(({ entry, parameters }) => ({
        id: `${WIRE}${String(entry.id)}`,
        name: typeof entry.name === 'string' && entry.name ? entry.name : String(entry.id),
        thinks: parameters.includes('reasoning'),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
