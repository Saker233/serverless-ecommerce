import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";

import { injectIdentityHeaders } from "../src/auth";

function eventWithClaims(
  claims: Record<string, unknown> | undefined,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /orders",
    rawPath: "/orders",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "x-auth-sub": "spoofed",
    },
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      authorizer: claims ? { jwt: { claims } } : undefined,
      domainName: "example.com",
      domainPrefix: "example",
      http: {
        method: "GET",
        path: "/orders",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "request-id",
      routeKey: "GET /orders",
      stage: "$default",
      time: "2026-01-01T00:00:00Z",
      timeEpoch: 0,
    },
    body: undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

describe("identity header injection", () => {
  it("injects trusted claims and removes spoofed headers", () => {
    const event = injectIdentityHeaders(
      eventWithClaims({
        sub: "user-1",
        username: "user@example.com",
        email: "user@example.com",
        token_use: "access",
        "cognito:groups": "customers",
      }),
    );

    expect(event.headers?.["X-Auth-Sub"]).toBe("user-1");
    expect(event.headers?.["X-Auth-Email"]).toBe("user@example.com");
    expect(event.headers?.["X-Auth-Token-Use"]).toBe("access");
    expect(event.headers?.["X-Auth-Groups"]).toBe("customers");
    expect(event.headers?.["x-auth-sub"]).toBeUndefined();
  });

  it("removes spoofed headers when claims are missing", () => {
    const event = injectIdentityHeaders(eventWithClaims(undefined));

    expect(event.headers?.["x-auth-sub"]).toBeUndefined();
    expect(event.headers?.["content-type"]).toBe("application/json");
  });
});
