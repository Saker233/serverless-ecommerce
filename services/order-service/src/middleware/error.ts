import type { ErrorRequestHandler, RequestHandler } from "express";

import type { Logger } from "../logger";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: {
      code: "not_found",
      message: "route not found",
    },
  });
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = res.locals.requestId as string | undefined;

    if ((error as { type?: string }).type === "entity.parse.failed") {
      res.status(400).json({
        error: {
          code: "invalid_request",
          message: "invalid JSON body",
        },
      });
      return;
    }

    logger.error("unhandled request error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: {
        code: "internal_error",
        message: "internal server error",
      },
    });
  };
}
