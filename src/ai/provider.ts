import { FixtureProvider } from './fixture-provider';

// The AI provider seam (T-305). The adapter only knows this interface, so tests use a mock and the
// real model is called only by `npm run eval` and the live smoke test (CLAUDE.md).
export interface AiPrompt {
  system: string;
  user: string;
}
export interface AiProvider {
  name: string;
  model: string;
  generate(prompt: AiPrompt, signal?: AbortSignal): Promise<string>;
}

/** Gemini over REST. The key goes in a header, never in the URL, and never in an error message. UNVERIFIED live until the smoke test. */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate(prompt: AiPrompt, signal?: AbortSignal): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    if (!text) throw new Error('Gemini returned no text');
    return text;
  }
}

/** Builds the provider from the environment, or null when no key is set (the app then runs on rules only). */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  if (env.AI_PROVIDER === 'fixture') {
    // Test only: Playwright sets both. Never in production, whatever the environment says.
    return env.KEEPMORE_E2E === '1' && env.NODE_ENV !== 'production' ? new FixtureProvider() : null;
  }
  const key = env.AI_API_KEY;
  if (!key || key === 'your-gemini-api-key' || (env.AI_PROVIDER ?? 'gemini') !== 'gemini') return null;
  return new GeminiProvider(key, env.AI_MODEL ?? 'gemini-3.5-flash-lite');
}
