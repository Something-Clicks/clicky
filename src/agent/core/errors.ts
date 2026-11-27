export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends AppError {
  constructor(message: string, code = 'validation_error') { super(code, message, 400); }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Not permitted', code = 'forbidden') { super(code, message, 403); }
}
export class NotFoundError extends AppError {
  constructor(what: string) { super('not_found', `${what} not found`, 404); }
}
export class ConflictError extends AppError {
  constructor(message: string, code = 'conflict') { super(code, message, 409); }
}
export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') { super('rate_limited', message, 429, true); }
}
export class BudgetExceededError extends AppError {
  constructor(message: string) { super('budget_exceeded', message, 402); }
}
/** Transient provider failure (timeout, 429, 5xx). Safe to retry. */
export class ProviderError extends AppError {
  constructor(message: string, retryable = true) { super('provider_error', message, 502, retryable); }
}
export class StructuredOutputError extends AppError {
  constructor(message: string, public readonly attempts: number, public readonly lastRaw?: string) {
    super('invalid_model_output', message, 502, false);
  }
}
/** True when mock/fixture output must be refused (production). */
export const mockForbidden = (): boolean => process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_IN_PRODUCTION !== 'yes';
export class NeedsInputError extends AppError {
  constructor(public readonly questions: string[]) {
    super('needs_input', `More information is required: ${questions.join(' | ')}`, 422);
  }
}
