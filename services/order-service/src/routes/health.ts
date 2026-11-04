import { Router } from "express";

import type { Config } from "../config";

export function healthRouter(config: Config): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      status: "ok",
      service: config.serviceName,
      version: config.version,
      environment: config.env,
      time: new Date().toISOString(),
    });
  });

  router.all("/health", (_req, res) => {
    res.setHeader("Allow", "GET");
    res.status(405).json({
      error: {
        code: "method_not_allowed",
        message: "method not allowed",
      },
    });
  });

  return router;
}
