import { Errors } from "../utils/AppError.js";

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      return next(Errors.validation(message));
    }
    req.body = result.data; // parsed/cleaned data
    next();
  };
}