import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildTestApp } from "./testApp";

describe("order service base", () => {
  it("returns health", async () => {
    const { app } = buildTestApp();
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
    const { app } = buildTestApp();
    const response = await request(app)
      .get("/health")
      .set("x-correlation-id", "test-correlation-id");

    expect(response.headers["x-correlation-id"]).toBe("test-correlation-id");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const { app } = buildTestApp();
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
    const { app } = buildTestApp();
    const response = await request(app).post("/health");

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET");
  });

  it("returns a JSON 400 for malformed JSON", async () => {
    const { app } = buildTestApp();
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
