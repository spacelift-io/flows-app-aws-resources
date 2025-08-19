import { EntityInput, EntityLifecycleCallbackOutput } from "@slflows/sdk/v1";
import { calculateConfigHash } from "./hash";
import { generateJsonPatch } from "./patch";
import {
  CloudControlClient,
  CreateResourceCommand,
  DeleteResourceCommand,
  GetResourceCommand,
  GetResourceRequestStatusCommand,
  UpdateResourceCommand,
} from "@aws-sdk/client-cloudcontrol";

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
 * Creates reusable onSync and onDrain handlers for AWS CloudControl resources
 */
export function createCloudControlHandlers(
  typeName: string,
  readOnlyPropertyKeys?: string[],
) {
  const onSync = async (
    input: EntityInput,
  ): Promise<EntityLifecycleCallbackOutput> => {
    const { app, block } = input;
    const { region, ...config } = block.config;
    const { requestToken, resourceIdentifier, configHash } =
      block.lifecycle?.signals || {};

    const currentConfigHash = calculateConfigHash(config);
    const client = createCloudControlClient(app, region);

    // No request token and no identifier suggests a creation.
    if (!requestToken && !resourceIdentifier) {
      const { ProgressEvent } = await client.send(
        new CreateResourceCommand({
          TypeName: typeName,
          DesiredState: JSON.stringify(config),
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

    // If we have a request token, let's check the status of the in-flight operation.
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
        // Let's get the new resource.
        const { ResourceDescription } = await client.send(
          new GetResourceCommand({
            TypeName: typeName,
            Identifier,
          }),
        );

        return {
          newStatus: "ready",
          signalUpdates: {
            ...(JSON.parse(ResourceDescription?.Properties || "") as Record<
              string,
              any
            >),
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

    // Looks like we have a config change, let's handle it by updating the resource.
    if (configHash !== currentConfigHash) {
      // First, get the current resource state to generate a proper patch
      const { ResourceDescription } = await client.send(
        new GetResourceCommand({
          TypeName: typeName,
          Identifier: resourceIdentifier,
        }),
      );

      const currentConfig = JSON.parse(ResourceDescription?.Properties || "{}");

      // Generate a proper JSON Patch document, excluding read-only properties
      const patchOperations = generateJsonPatch(
        currentConfig,
        config,
        readOnlyPropertyKeys,
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

    // If we reach here, it means the resource is already in sync.
    return { newStatus: "ready" };
  };

  const onDrain = async (
    input: EntityInput,
  ): Promise<EntityLifecycleCallbackOutput> => {
    const { app, block } = input;
    const { requestToken, resourceIdentifier } = block.lifecycle?.signals || {};

    // Nothing to clean up, we're good.
    if (!requestToken && !resourceIdentifier) {
      return { newStatus: "drained" };
    }

    const { region } = block.config;
    const client = createCloudControlClient(app, region);

    // If we have a request token, we query for the status.
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
  };

  return { onSync, onDrain };
}
