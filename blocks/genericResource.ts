import {
  kv,
  AppBlock,
  EntityInput,
  EntityLifecycleCallbackOutput,
} from "@slflows/sdk/v1";
import {
  CloudControlClient,
  CreateResourceCommand,
  DeleteResourceCommand,
  GetResourceCommand,
  GetResourceRequestStatusCommand,
  UpdateResourceCommand,
} from "@aws-sdk/client-cloudcontrol";
import {
  CloudFormationClient,
  DescribeTypeCommand,
} from "@aws-sdk/client-cloudformation";
import { calculateConfigHash } from "../utils/hash";
import { generateJsonPatch } from "../utils/patch";

/**
 * Creates a CloudControl client with AWS credentials from app config
 */
function createCloudControlClient(
  app: EntityInput["app"],
  region: string,
): CloudControlClient {
  return new CloudControlClient({
    region,
    credentials: {
      accessKeyId: app.config.accessKeyId,
      secretAccessKey: app.config.secretAccessKey,
      sessionToken: app.config.sessionToken,
    },
  });
}

/**
 * Creates a CloudFormation client with AWS credentials from app config
 */
function createCloudFormationClient(
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
async function getNonUpdatableProperties(
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

export const genericResource: AppBlock = {
  name: "Generic Resource",
  description:
    "Manage any AWS resource [supported by CloudControl](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html) by specifying the type name (eg. AWS::EC2::Instance) and desired state. If you're not super familiar with AWS resource APIs, we suggest using the AI agent to help you get the configuration right.",
  category: "Generic",

  config: {
    region: {
      name: "Region",
      description: "The AWS region for provisioning the resource",
      type: "string",
      required: true,
      fixed: true,
    },
    typeName: {
      name: "Type Name",
      description:
        "The CloudFormation resource type name (e.g., AWS::S3::Bucket)",
      type: "string",
      required: true,
      fixed: true,
    },
    state: {
      name: "Desired State",
      description:
        "The desired configuration state for the resource as a JSON object",
      type: {
        type: "object",
        additionalProperties: true,
      },
      required: true,
    },
  },

  signals: {
    region: {
      name: "Region",
      description: "The AWS region where the resource is provisioned",
    },
    typeName: {
      name: "Type Name",
      description: "The CloudFormation resource type name",
    },
    state: {
      name: "Current State",
      description: "The current state of the resource",
    },
    configHash: {
      name: "Config Hash",
      description:
        "The hash of the configuration for the AWS resource, used to detect changes",
    },
    requestToken: {
      name: "Request Token",
      description: "The request token for the AWS resource operation",
    },
    resourceIdentifier: {
      name: "Resource Identifier",
      description: "The unique identifier for the AWS resource",
    },
  },

  async onSync(input: EntityInput): Promise<EntityLifecycleCallbackOutput> {
    const { app, block } = input;
    const { region, typeName, state } = block.config;
    const { requestToken, resourceIdentifier, configHash } =
      block.lifecycle?.signals || {};

    const currentConfigHash = calculateConfigHash(state);
    const client = createCloudControlClient(app, region);

    // Get the non-updatable properties for this resource type
    let nonUpdatablePropertyKeys: string[] = [];
    try {
      nonUpdatablePropertyKeys = await getNonUpdatableProperties(
        input,
        typeName,
      );
    } catch (error) {
      console.warn(
        `Could not retrieve non-updatable properties for ${typeName}:`,
        error,
      );
      // Continue without non-updatable property information
    }

    // No request token and no identifier suggests a creation
    if (!requestToken && !resourceIdentifier) {
      const { ProgressEvent } = await client.send(
        new CreateResourceCommand({
          TypeName: typeName,
          DesiredState: JSON.stringify(state),
        }),
      );

      const { RequestToken, OperationStatus, StatusMessage } = ProgressEvent!;

      if (OperationStatus === "FAILED") {
        console.log("Error creating resource: ", StatusMessage);
        return {
          newStatus: "failed",
          customStatusDescription: "Creation failed, see logs",
        };
      }

      return {
        newStatus: "in_progress",
        signalUpdates: {
          configHash: currentConfigHash,
          requestToken: RequestToken,
        },
        nextScheduleDelay: 10,
      };
    }

    // If we have a request token, check the status of the in-flight operation
    if (requestToken) {
      const { ProgressEvent } = await client.send(
        new GetResourceRequestStatusCommand({ RequestToken: requestToken }),
      );

      const {
        Identifier,
        Operation,
        OperationStatus,
        RequestToken: NewRequestToken,
        StatusMessage,
      } = ProgressEvent!;

      if (OperationStatus === "FAILED") {
        console.log("Resource error: ", StatusMessage);
        return {
          newStatus: "failed",
          signalUpdates: { requestToken: null },
          customStatusDescription: `${Operation} failed, see logs`,
        };
      }

      if (OperationStatus === "SUCCESS") {
        // Get the current resource state
        const { ResourceDescription } = await client.send(
          new GetResourceCommand({
            TypeName: typeName,
            Identifier,
          }),
        );

        const resourceProperties = JSON.parse(
          ResourceDescription?.Properties || "{}",
        );

        return {
          newStatus: "ready",
          signalUpdates: {
            state: resourceProperties,
            requestToken: null,
            resourceIdentifier: Identifier,
          },
        };
      }

      return {
        newStatus: "in_progress",
        signalUpdates: { requestToken: NewRequestToken },
        nextScheduleDelay: 10,
      };
    }

    // Handle config changes by updating the resource
    if (configHash !== currentConfigHash) {
      // Get the current resource state to generate a proper patch
      const { ResourceDescription } = await client.send(
        new GetResourceCommand({
          TypeName: typeName,
          Identifier: resourceIdentifier,
        }),
      );

      const currentState = JSON.parse(ResourceDescription?.Properties || "{}");

      // Generate a proper JSON Patch document, excluding non-updatable properties
      const patchOperations = generateJsonPatch(
        currentState,
        state,
        nonUpdatablePropertyKeys,
      );

      // If no changes detected, skip update
      if (patchOperations.length === 0) {
        return {
          newStatus: "ready",
          signalUpdates: { configHash: currentConfigHash },
        };
      }

      const { ProgressEvent } = await client.send(
        new UpdateResourceCommand({
          TypeName: typeName,
          Identifier: resourceIdentifier,
          PatchDocument: JSON.stringify(patchOperations),
        }),
      );

      const { RequestToken, OperationStatus, StatusMessage } = ProgressEvent!;

      if (OperationStatus === "FAILED") {
        console.log("Error updating resource: ", StatusMessage);
        return {
          newStatus: "failed",
          customStatusDescription: "Update failed, see logs",
        };
      }

      return {
        newStatus: "in_progress",
        signalUpdates: {
          configHash: currentConfigHash,
          requestToken: RequestToken,
        },
        nextScheduleDelay: 10,
      };
    }

    // Resource is already in sync
    return { newStatus: "ready" };
  },

  async onDrain(input: EntityInput): Promise<EntityLifecycleCallbackOutput> {
    const { app, block } = input;
    const { region, typeName } = block.config;
    const { requestToken, resourceIdentifier } = block.lifecycle?.signals || {};

    // Nothing to clean up
    if (!requestToken && !resourceIdentifier) {
      return { newStatus: "drained" };
    }

    const client = createCloudControlClient(app, region);

    // If we have a request token, query for the status
    if (requestToken) {
      const { ProgressEvent } = await client.send(
        new GetResourceRequestStatusCommand({ RequestToken: requestToken }),
      );

      const { OperationStatus, StatusMessage } = ProgressEvent!;

      if (OperationStatus === "FAILED") {
        console.log("Resource error: ", StatusMessage);
        return {
          newStatus: "failed",
          signalUpdates: { requestToken: null },
          customStatusDescription: "Deletion failed, see logs",
        };
      }

      if (OperationStatus === "SUCCESS") {
        return {
          newStatus: "drained",
          signalUpdates: { requestToken: null },
        };
      }

      return {
        newStatus: "draining",
        nextScheduleDelay: 10,
      };
    }

    // Start deletion
    const { ProgressEvent } = await client.send(
      new DeleteResourceCommand({
        TypeName: typeName,
        Identifier: resourceIdentifier,
      }),
    );

    const { RequestToken, OperationStatus, StatusMessage } = ProgressEvent!;

    if (OperationStatus === "FAILED") {
      console.log("Error deleting resource: ", StatusMessage);
      return {
        newStatus: "failed",
        customStatusDescription: "Deletion failed, see logs",
      };
    }

    if (OperationStatus === "SUCCESS") {
      return {
        newStatus: "drained",
        signalUpdates: { requestToken: null },
      };
    }

    return {
      newStatus: "draining",
      signalUpdates: { requestToken: RequestToken },
      nextScheduleDelay: 10,
    };
  },
};
