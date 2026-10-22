// Whether the AG Studio AI assistant can be offered, and if not, why (shown on the button, so it never just vanishes).
export type AssistantStatus = { ready: true } | { ready: false; reason: string };

export function assistantStatus(input: { ai: 'gemini' | 'fixture' | null; demoLines: number }): AssistantStatus {
  if (!input.ai)
    return {
      ready: false,
      reason: 'No AI model is set on the server. Check AI_API_KEY (and AI_PROVIDER=gemini, or leave it unset) in .env, then restart npm run dev.',
    };
  if (input.demoLines === 0)
    return { ready: false, reason: 'The assistant works on the demo shop only, and there is none. Run npm run db:seed.' };
  return { ready: true };
}
