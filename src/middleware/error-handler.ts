import { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/errors";
import { logger } from "../utils/logger";

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  const parserError = error as { type?: string } | null;
  if (parserError?.type === "entity.parse.failed" || parserError?.type === "entity.too.large") {
    const tooLarge = parserError.type === "entity.too.large";
    res.status(tooLarge ? 413 : 400).json({ error: {
      code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
      message: tooLarge ? "Request body is too large" : "Invalid JSON body",
    } });
    return;
  }
  logger.error("request.error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
};
