// Shared domain errors with machine-readable codes.

export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export class TaskBankValidationError extends DomainError {
  constructor(message: string) {
    super('TASK_BANK_VALIDATION', message);
  }
}

export class PlanBuildError extends DomainError {
  constructor(message: string) {
    super('PLAN_BUILD', message);
  }
}
