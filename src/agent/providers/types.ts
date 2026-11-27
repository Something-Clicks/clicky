/** Provider-neutral model interface. Anything that can turn a request into JSON text plugs in here
 *  (OpenAI, Anthropic, Gemini, a self-hosted OpenAI-compatible server, or the test mock). */
export interface UntrustedBlock { id: string; source: string; text: string }

export interface ProviderRequest {
  /** Logical task name, e.g. 'business_understanding'. Used for routing/logging, never for trust. */
  task: string;
  system: string;
  instructions: string;
  /** Trusted, application-built structured input. */
  input: unknown;
  /** Website text, uploads, competitor pages: DATA ONLY. Adapters must fence these. */
  untrusted?: UntrustedBlock[];
  /** JSON Schema of the expected output (adapters may use native structured-output modes). */
  jsonSchema?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  /** Set on retries so the model can see why the last output was rejected. */
  priorError?: string;
}
export interface ProviderResponse {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}
export interface LLMProvider {
  readonly name: string;
  /** True for test doubles. Results produced by mocks are labelled as such end-to-end (spec §17.5). */
  readonly isMock: boolean;
  complete(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>;
}
