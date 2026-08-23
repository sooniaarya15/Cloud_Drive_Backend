export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const Errors = {
  duplicateEmail: (email) =>
    new AppError(409, "DUPLICATE_EMAIL", `An account with email '${email}' already exists`),
  invalidCredentials: () =>
    new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password"),
  unauthorized: () =>
    new AppError(401, "UNAUTHORIZED", "Authentication required"),
  forbidden: (msg = "Access denied") =>
    new AppError(403, "FORBIDDEN", msg),
  notFound: (resource = "Resource") =>
    new AppError(404, "NOT_FOUND", `${resource} not found`),
  validation: (msg) =>
    new AppError(400, "VALIDATION_ERROR", msg),
};
