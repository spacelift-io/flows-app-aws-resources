import { EntityInput, kv } from "@slflows/sdk/v1";
import {
  CloudFormationClient,
  DescribeTypeCommand,
} from "@aws-sdk/client-cloudformation";

/**
 * Creates a CloudFormation client with AWS credentials from app config
 */
export function createCloudFormationClient(
  app: EntityInput["app"],
  region: string,
): CloudFormationClient {
  return new CloudFormationClient({
    region,
    credentials: {
      accessKeyId: app.config.accessKeyId,
      secretAccessKey: app.config.secretAccessKey,
      sessionToken: app.config.sessionToken,
    },
  });
}

/**
 * Retrieves and caches properties that cannot be updated (read-only + create-only)
 */
export async function getNonUpdatableProperties(
  input: EntityInput,
  typeName: string,
): Promise<string[]> {
  const { app, block } = input;
  const { region } = block.config;
  const cacheKey = `nonupdatable:${typeName}`;

  // Try to get from cache first
  let { value } = await kv.block.get(cacheKey);
  if (value) {
    return value as string[];
  }

  // Fetch from CloudFormation API
  const client = createCloudFormationClient(app, region);
  const response = await client.send(
    new DescribeTypeCommand({
      Type: "RESOURCE",
      TypeName: typeName,
    }),
  );

  if (!response.Schema) {
    throw new Error(`Schema not found for type: ${typeName}`);
  }

  const schema = JSON.parse(response.Schema);

  // Extract read-only properties (cannot be updated)
  const readOnlyProperties = (schema.readOnlyProperties || []).map(
    (prop: string) => prop.replace("/properties/", ""),
  );

  // Extract create-only properties (cannot be updated after creation)
  const createOnlyProperties = (schema.createOnlyProperties || []).map(
    (prop: string) => prop.replace("/properties/", ""),
  );

  // Combine both types of non-updatable properties
  const nonUpdatableProperties = [
    ...readOnlyProperties,
    ...createOnlyProperties,
  ];

  // Cache only the non-updatable property names (not the entire schema)
  await kv.block.set({ key: cacheKey, value: nonUpdatableProperties });

  return nonUpdatableProperties;
}
