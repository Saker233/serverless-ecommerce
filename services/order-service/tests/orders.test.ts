import request from "supertest";
import { describe, expect, it } from "vitest";

import { authHeaders, buildTestApp } from "./testApp";

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        productId: "product-1",
        sku: "SKU-1",
        name: "Mechanical Keyboard",
        quantity: 2,
        unitPriceCents: 4999,
        currency: "eur",
        productVersion: 3,
      },
    ],
    ...overrides,
  };
}

function createOrder(
  app: ReturnType<typeof buildTestApp>["app"],
  sub = "user-1",
  key = "key-1",
  body: Record<string, unknown> = orderBody(),
) {
  return request(app)
    .post("/orders")
    .set(authHeaders(sub))
    .set("idempotency-key", key)
    .send(body);
}

describe("orders", () => {
  it("creates an order from the token subject", async () => {
    const { app } = buildTestApp();
    const response = await createOrder(app);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      customerId: "user-1",
      status: "PENDING",
      totalCents: 9998,
      currency: "EUR",
      version: 1,
    });
    expect(response.body.orderId).toEqual(expect.any(String));
    expect(response.body.items[0]).toMatchObject({
      productId: "product-1",
      sku: "SKU-1",
      quantity: 2,
      unitPriceCents: 4999,
      currency: "EUR",
      productVersion: 3,
    });
  });

  it("requires authentication", async () => {
    const { app } = buildTestApp();
    const response = await request(app).get("/orders");

    expect(response.status).toBe(401);
  });

  it("requires an idempotency key", async () => {
    const { app } = buildTestApp();
    const response = await request(app)
      .post("/orders")
      .set(authHeaders())
      .send(orderBody());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("replays the same idempotent request", async () => {
    const { app } = buildTestApp();
    const first = await createOrder(app, "user-1", "same-key");
    const second = await createOrder(app, "user-1", "same-key");

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.orderId).toBe(first.body.orderId);
  });

  it("rejects the same idempotency key with a different body", async () => {
    const { app } = buildTestApp();
    await createOrder(app, "user-1", "same-key");
    const response = await createOrder(
      app,
      "user-1",
      "same-key",
      orderBody({
        items: [
          {
            productId: "product-2",
            sku: "SKU-2",
            name: "Mouse",
            quantity: 1,
            unitPriceCents: 1999,
            currency: "EUR",
          },
        ],
      }),
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("idempotency_conflict");
  });

  it("gets an owned order and hides another customer's order", async () => {
    const { app } = buildTestApp();
    const created = await createOrder(app);
    const orderId = created.body.orderId as string;

    const owned = await request(app)
      .get(`/orders/${orderId}`)
      .set(authHeaders("user-1"));
    expect(owned.status).toBe(200);
    expect(owned.body.orderId).toBe(orderId);

    const other = await request(app)
      .get(`/orders/${orderId}`)
      .set(authHeaders("user-2"));
    expect(other.status).toBe(404);
  });

  it("lists only the caller's orders and paginates", async () => {
    const { app } = buildTestApp();
    await createOrder(app, "user-1", "key-1");
    await createOrder(app, "user-1", "key-2");
    await createOrder(app, "user-1", "key-3");
    await createOrder(app, "user-2", "user-2-key");

    const first = await request(app)
      .get("/orders?limit=2")
      .set(authHeaders("user-1"));

    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app)
      .get(`/orders?limit=2&cursor=${first.body.nextCursor}`)
      .set(authHeaders("user-1"));

    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeUndefined();
  });

  it("validates order items", async () => {
    const { app } = buildTestApp();
    const response = await createOrder(
      app,
      "user-1",
      "bad-key",
      orderBody({
        items: [
          {
            productId: "product-1",
            sku: "SKU-1",
            name: "Keyboard",
            quantity: 0,
            unitPriceCents: 1000,
            currency: "EUR",
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });
});
