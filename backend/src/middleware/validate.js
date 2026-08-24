import { Errors } from "../utils/AppError.js";

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues || result.error.errors || [];
      const message = issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      return next(Errors.validation(message || "Invalid input"));
    }
    req.body = result.data; // parsed/cleaned data
    next();
  };
}