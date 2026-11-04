import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface AuthContext {
  sub: string;
  email: string;
  username: string;
  groups: string[];
  tokenUse: string;
}

export const requireAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const sub = (req.header("x-auth-sub") ?? "").trim();
  const tokenUse = (req.header("x-auth-token-use") ?? "").trim();

  if (!sub || tokenUse !== "access") {
    res.status(401).json({
      error: {
        code: "unauthorized",
        message: "authentication required",
      },
    });
    return;
  }

  const groupsHeader = (req.header("x-auth-groups") ?? "").trim();

  res.locals.auth = {
    sub,
    email: (req.header("x-auth-email") ?? "").trim(),
    username: (req.header("x-auth-username") ?? "").trim(),
    groups: parseGroups(groupsHeader),
    tokenUse,
  } satisfies AuthContext;

  next();
};

export function authFrom(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}

export function injectIdentityHeaders(
  event: APIGatewayProxyEventV2,
): APIGatewayProxyEventV2 {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (!key.toLowerCase().startsWith("x-auth-") && value !== undefined) {
      headers[key] = value;
    }
  }

  const requestContext = event.requestContext as unknown as {
    authorizer?: {
      jwt?: {
        claims?: Record<string, unknown>;
      };
    };
  };
  const claims = requestContext.authorizer?.jwt?.claims ?? {};

  if (Object.keys(claims).length === 0) {
    event.headers = headers;
    return event;
  }

  const username = String(claims.username ?? "").trim();
  const email = String(claims.email ?? "").trim() || (username.includes("@") ? username : "");
  const rawGroups = claims["cognito:groups"] ?? "";

  headers["X-Auth-Sub"] = String(claims.sub ?? "").trim();
  headers["X-Auth-Email"] = email;
  headers["X-Auth-Username"] = username;
  headers["X-Auth-Groups"] = Array.isArray(rawGroups)
    ? rawGroups.join(",")
    : String(rawGroups);
  headers["X-Auth-Token-Use"] = String(claims.token_use ?? "").trim();

  event.headers = headers;
  return event;
}

function parseGroups(value: string): string[] {
  if (!value) {
    return [];
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((group) => String(group));
      }
    } catch {
      return value
        .slice(1, -1)
        .split(",")
        .map((group) => group.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    }
  }

  return value
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean);
}
