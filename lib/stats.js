// Compteurs en mémoire : requêtes, tokens et latences par mode, dernières questions.
const modes = () => ({ requests: 0, errors: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalMs: 0 });

export const stats = {
  startedAt: new Date().toISOString(),
  byMode: { llm: modes(), rag: modes(), graph: modes(), judge: modes() },
  recent: [],
  record(mode, { usage, ms, error, question }) {
    const m = this.byMode[mode] || (this.byMode[mode] = modes());
    m.requests++;
    if (error) m.errors++;
    if (usage) {
      m.promptTokens += usage.prompt_tokens || 0;
      m.completionTokens += usage.completion_tokens || 0;
      m.reasoningTokens += usage.completion_tokens_details?.reasoning_tokens || 0;
    }
    if (ms) m.totalMs += ms;
    if (question && mode === "llm") {
      this.recent.unshift({ at: new Date().toISOString(), question: question.slice(0, 160) });
      if (this.recent.length > 30) this.recent.pop();
    }
  },
  snapshot() {
    const byMode = {};
    for (const [k, m] of Object.entries(this.byMode)) byMode[k] = { ...m, totalTokens: m.promptTokens + m.completionTokens, avgMs: m.requests ? Math.round(m.totalMs / m.requests) : 0 };
    return { startedAt: this.startedAt, byMode, recent: this.recent };
  },
};
