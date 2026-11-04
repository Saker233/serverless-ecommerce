import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import serverless from "serverless-http";

import { createApp } from "./app";
import { loadConfig } from "./config";

const app = createApp(loadConfig());
const serverlessHandler = serverless(app) as (
  event: APIGatewayProxyEventV2,
  context: Context,
) => Promise<unknown>;

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<unknown> {
  const headers = event.headers ?? {};
  const hasCorrelationId = Object.keys(headers).some(
    (key) => key.toLowerCase() === "x-correlation-id",
  );

  if (!hasCorrelationId && event.requestContext?.requestId) {
    event.headers = {
      ...headers,
      "x-correlation-id": event.requestContext.requestId,
    };
  }

  return serverlessHandler(event, context);
}
