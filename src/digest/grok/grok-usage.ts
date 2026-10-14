/** Token counts xAI reports in `usage` of a chat completion. */
export interface GrokUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

/**
 * Sums the usage of every Grok response of one digest stage, retries included: each answered
 * attempt is billed, even when its content is then rejected.
 */
export class GrokUsageMeter {
  private readonly total: GrokUsage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

  add(usage: GrokUsage): void {
    this.total.promptTokens += usage.promptTokens;
    this.total.completionTokens += usage.completionTokens;
    this.total.reasoningTokens += usage.reasoningTokens;
  }

  get usage(): GrokUsage {
    return { ...this.total };
  }

  /** Fragment of a log line; counts only, never prompt or answer text. */
  describe(): string {
    const { promptTokens, completionTokens, reasoningTokens } = this.total;
    return `tokens in=${promptTokens} out=${completionTokens} reasoning=${reasoningTokens}`;
  }
}

/** Reads `usage` of a response body; missing or malformed fields count as zero. */
export function readGrokUsage(body: unknown): GrokUsage {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  const details = usage?.completion_tokens_details as Record<string, unknown> | undefined;
  return {
    promptTokens: countOf(usage?.prompt_tokens),
    completionTokens: countOf(usage?.completion_tokens),
    reasoningTokens: countOf(details?.reasoning_tokens),
  };
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
