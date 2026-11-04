import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

import type { Logger } from "../logger";

const correlationHeader = "x-correlation-id";
const maxRequestIdLength = 128;

function safeRequestId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > maxRequestIdLength) {
    return undefined;
  }

  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) {
      return undefined;
    }
  }

  return trimmed;
}

export function correlation(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId =
      safeRequestId(req.header(correlationHeader)) ?? randomUUID();

    res.locals.requestId = requestId;
    res.setHeader(correlationHeader, requestId);

    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const latencyMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      logger.info("request completed", {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        latencyMs: Math.round(latencyMs * 100) / 100,
      });
    });

    next();
  };
}
