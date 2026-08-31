/**
 * Environment configuration.
 *
 * The prototype must run with no .env at all: routing from the built-in graph,
 * signals from the seeded store, explanations from the deterministic template.
 * Anything optional degrades to that baseline rather than failing to boot.
 */

export const config = {
  port: Number.parseInt(process.env.PORT ?? '8787', 10),
  isProduction: process.env.NODE_ENV === 'production',
  hasExplanationModel: Boolean(process.env.ANTHROPIC_API_KEY),
  explanationModel: process.env.EXPLANATION_MODEL ?? 'claude-haiku-4-5-20251001',
  routingProvider: process.env.ROUTING_PROVIDER ?? 'graph',
} as const
