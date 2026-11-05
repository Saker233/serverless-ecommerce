import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export function createDocumentClient(): DynamoDBDocumentClient {
  const region = process.env.AWS_REGION;
  const client = new DynamoDBClient(region ? { region } : {});

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}
