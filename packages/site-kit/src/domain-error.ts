/** Thrown by a tool/domain operation to render a structured error (never a 500). */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
