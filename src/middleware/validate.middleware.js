import { z } from "zod";

/**
 * Turns a Zod issue list into one flat `field: message` map so the frontend can
 * highlight individual inputs instead of showing a single opaque string.
 */
const formatIssues = (issues) => {
  const errors = {};

  for (const issue of issues) {
    const path = issue.path.length ? issue.path.join(".") : "_";
    if (!errors[path]) errors[path] = issue.message;
  }

  return errors;
};

/**
 * Validates request parts against Zod schemas before the controller runs.
 *
 * Parsed output replaces the original `req.body`/`req.query`/`req.params`, so
 * controllers receive coerced and trimmed values. Schemas here are deliberately
 * permissive about unknown keys: several controllers accept alias fields
 * (`qty` for `quantity`, `text` for `comment`) and stripping them would change
 * existing behaviour.
 *
 * @param {{ body?: import("zod").ZodTypeAny, query?: import("zod").ZodTypeAny, params?: import("zod").ZodTypeAny }} schemas
 */
export const validate = (schemas) => (req, res, next) => {
  for (const part of ["params", "query", "body"]) {
    const schema = schemas[part];
    if (!schema) continue;

    const result = schema.safeParse(req[part]);

    if (!result.success) {
      const errors = formatIssues(result.error.issues);
      const [firstMessage] = Object.values(errors);

      return res.status(400).json({
        success: false,
        message: firstMessage || "Invalid request",
        errors,
      });
    }

    // req.query is a getter on Express 5, so assign only when parsing changed it.
    if (part === "query") {
      Object.defineProperty(req, "query", { value: result.data, writable: true });
    } else {
      req[part] = result.data;
    }
  }

  return next();
};

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * Object schema that keeps unknown keys.
 *
 * Required, not cosmetic: Zod 4 strips unrecognised keys by default, and this
 * middleware writes the parsed result back onto the request. A strict object
 * would silently delete the alias fields several controllers read (`qty`,
 * `text`, `product`) and change behaviour for existing clients.
 */
export const looseBody = (shape) => z.looseObject(shape);

/** A Mongo ObjectId as a 24-character hex string. */
export const objectId = (label = "id") =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .regex(OBJECT_ID_PATTERN, `${label} must be a valid id`);

/** Trimmed, non-empty string with a length ceiling to bound stored document size. */
export const boundedString = ({ label, min = 1, max = 500 }) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, min === 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be ${max} characters or fewer`);

/** Positive integer, coercing the string forms that arrive from query strings. */
export const positiveInt = ({ label, max = 1_000_000 }) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .positive(`${label} must be greater than zero`)
    .max(max, `${label} must be ${max} or less`);

export { z };
