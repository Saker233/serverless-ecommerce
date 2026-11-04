import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { loadConfig } from "../src/config";

const app = createApp(
  loadConfig({
    ENV: "test",
    SERVICE_NAME: "order-service",
    VERSION: "test",
    LOG_LEVEL: "error",
    PORT: "8002",
  }),
);

describe("order service base", () => {
  it("returns health", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      status: "ok",
      service: "order-service",
      version: "test",
      environment: "test",
    });
    expect(response.body.time).toEqual(expect.any(String));
    expect(response.headers["x-correlation-id"]).toEqual(expect.any(String));
  });

  it("echoes a supplied correlation ID", async () => {
    const response = await request(app)
      .get("/health")
      .set("x-correlation-id", "test-correlation-id");

    expect(response.headers["x-correlation-id"]).toBe("test-correlation-id");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const response = await request(app).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "not_found",
        message: "route not found",
      },
    });
  });

  it("rejects non-GET health requests", async () => {
    const response = await request(app).post("/health");

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET");
  });

  it("returns a JSON 400 for malformed JSON", async () => {
    const response = await request(app)
      .post("/does-not-exist")
      .set("content-type", "application/json")
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "invalid_request",
        message: "invalid JSON body",
      },
    });
  });
});
