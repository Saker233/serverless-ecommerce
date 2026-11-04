import { Router, type NextFunction, type Response } from "express";

import { authFrom, requireAuth } from "../auth";
import {
  IdempotencyConflictError,
  OrderNotFoundError,
  ValidationError,
} from "../orders/domain";
import type { OrderService } from "../orders/service";

export function ordersRouter(service: OrderService): Router {
  const router = Router();

  router.use("/orders", requireAuth);

  router.post("/orders", async (req, res, next) => {
    try {
      const result = await service.create(
        authFrom(res).sub,
        req.body,
        req.header("idempotency-key"),
      );

      res.status(result.created ? 201 : 200).json(result.order);
    } catch (error) {
      handleOrderError(error, res, next);
    }
  });

  router.get("/orders/:id", async (req, res, next) => {
    try {
      const order = await service.get(authFrom(res).sub, req.params.id);
      res.status(200).json(order);
    } catch (error) {
      handleOrderError(error, res, next);
    }
  });

  router.get("/orders", async (req, res, next) => {
    try {
      const limit = parseLimit(req.query.limit);
      const cursor = parseStringQuery(req.query.cursor);

      const result = await service.list(authFrom(res).sub, limit, cursor);
      res.status(200).json({
        items: result.orders,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      });
    } catch (error) {
      handleOrderError(error, res, next);
    }
  });

  return router;
}

function handleOrderError(
  error: unknown,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof ValidationError) {
    res.status(400).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (error instanceof IdempotencyConflictError) {
    res.status(409).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (error instanceof OrderNotFoundError) {
    res.status(404).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  next(error);
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return 20;
  }

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ValidationError("limit must be an integer between 1 and 100");
  }

  const limit = Number(value);
  if (limit < 1 || limit > 100) {
    throw new ValidationError("limit must be an integer between 1 and 100");
  }

  return limit;
}

function parseStringQuery(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("cursor must be a non-empty string");
  }

  return value.trim();
}
