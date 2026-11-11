export const errorMessages = {
  INVALID_ARGUMENT: 'Invalid tool arguments. Check the published input schema.',
  ROUTING_DISABLED: 'DeepSeek routing is disabled. An operator must explicitly enable it.',
  PAID_REQUESTS_DISABLED: 'Paid DeepSeek requests have not been authorized by the operator.',
  NOT_CONFIGURED: 'DeepSeek credentials or current pricing acknowledgement are missing.',
  TOKEN_LIMIT: 'The request exceeds the configured input or token limit.',
  COST_LIMIT: 'The estimated request cost exceeds the configured limit.',
  BUDGET_EXCEEDED: 'The daily or lifetime budget or daily call limit is exhausted.',
  DUPLICATE_REQUEST: 'This request_id has already been reserved. Do not retry it with a new ID without checking the ledger.',
  UPSTREAM_AUTH: 'DeepSeek rejected the server credentials.',
  UPSTREAM_RATE_LIMIT: 'DeepSeek rate limit reached. No automatic retry was made.',
  UPSTREAM_ERROR: 'DeepSeek returned an error. The cost reservation was retained.',
  UPSTREAM_INVALID_RESPONSE: 'DeepSeek returned an invalid or oversized response. The cost reservation was retained.',
  UPSTREAM_TIMEOUT: 'The request timed out or was cancelled. The cost reservation was retained; DeepSeek may still bill it.',
  ACCOUNTING_ERROR: 'Budget accounting failed. No further requests should be made until the ledger is checked.',
  INTERNAL_ERROR: 'The server could not complete the request.',
} as const;
export type ErrorCode = keyof typeof errorMessages;
export class AppError extends Error {
  constructor(readonly code: ErrorCode) { super(errorMessages[code]); }
}
export function safeError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError('INTERNAL_ERROR');
}
