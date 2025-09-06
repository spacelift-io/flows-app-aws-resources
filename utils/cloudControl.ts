import {
  EntityInput,
  EntityLifecycleCallbackOutput,
  kv,
  events,
} from "@slflows/sdk/v1";
import { calculateConfigHash } from "./hash";
import { generateJsonPatch } from "./patch";
import { deepEqual, logDrift, getDriftedFields } from "./compare";
import {
  CloudControlClient,
  CreateResourceCommand,
  DeleteResourceCommand,
  GetResourceCommand,
  GetResourceRequestStatusCommand,
  UpdateResourceCommand,
} from "@aws-sdk/client-cloudcontrol";

const CONFIG_HASH_KEY = "internal:configHash";
const REQUEST_TOKEN_KEY = "internal:requestToken";

/**
 * Creates a CloudControl client with AWS credentials from app config
 */
export function createCloudControlClient(
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

interface CloudControlHandlerOptions {
  /** Static type name or function to extract from config */
  typeName: string | ((config: Record<string, any>) => string);
  /** Function to extract desired state from block config */
  getDesiredState: (config: Record<string, any>) => Record<string, any>;
  /** Static list or async function to get non-updatable properties */
  getNonUpdatableProperties?:
    | string[]
    | ((input: EntityInput, typeName: string) => Promise<string[]>);
}

/**
 * Creates reusable onSync and onDrain handlers for AWS CloudControl resources
 */
export function createCloudControlHandlers(
  options: CloudControlHandlerOptions,
) {
  const opts = options;
  const onSync = async (
    input: EntityInput,
  ): Promise<EntityLifecycleCallbackOutput> => {
    const { app, block } = input;
    const { region } = block.config;
    const { resourceIdentifier, state } = block.lifecycle?.signals || {};

    // Get internal state from KV
    const { value: requestToken } = await kv.block.get(REQUEST_TOKEN_KEY);
    const { value: configHash } = await kv.block.get(CONFIG_HASH_KEY);

    // Extract type name and desired state using options
    const resolvedTypeName =
      typeof opts.typeName === "string"
        ? opts.typeName
        : opts.typeName(block.config);
    const desiredState = opts.getDesiredState(block.config);

    const currentConfigHash = calculateConfigHash(desiredState);
    const client = createCloudControlClient(app, region);

    // Get non-updatable properties
    let nonUpdatablePropertyKeys: string[] = [];
    if (opts.getNonUpdatableProperties) {
      if (Array.isArray(opts.getNonUpdatableProperties)) {
        nonUpdatablePropertyKeys = opts.getNonUpdatableProperties;
      } else {
        try {
          nonUpdatablePropertyKeys = await opts.getNonUpdatableProperties(
            input,
            resolvedTypeName,
          );
        } catch (error) {
          console.warn(
            `Could not retrieve non-updatable properties for ${resolvedTypeName}:`,
            error,
          );
        }
      }
    }

    // No request token and no identifier suggests a creation.
    if (!requestToken && !resourceIdentifier) {
      const { ProgressEvent } = await client.send(
        new CreateResourceCommand({
          TypeName: resolvedTypeName,
          DesiredState: JSON.stringify(desiredState),
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

      // Store internal state in KV
      await kv.block.setMany([
        { key: CONFIG_HASH_KEY, value: currentConfigHash },
        { key: REQUEST_TOKEN_KEY, value: RequestToken },
      ]);

      return {
        newStatus: "in_progress",
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
        // Clear internal state from KV
        await kv.block.delete([REQUEST_TOKEN_KEY]);
        return {
          newStatus: "failed",
          customStatusDescription: `${Operation} failed, see logs`,
        };
      }

      if (OperationStatus === "SUCCESS") {
        // Let's get the new resource.
        const { ResourceDescription } = await client.send(
          new GetResourceCommand({
            TypeName: resolvedTypeName,
            Identifier,
          }),
        );

        const resourceProperties = JSON.parse(
          ResourceDescription?.Properties || "{}",
        );

        // Clear internal state from KV and update signals
        await kv.block.delete([REQUEST_TOKEN_KEY]);

        // Emit output if state changed
        const previousState = (state as Record<string, any>) || {};
        const stateChanged = !deepEqual(
          resourceProperties,
          previousState,
          nonUpdatablePropertyKeys,
        );

        if (stateChanged) {
          await events.emit({
            state: resourceProperties,
            resourceIdentifier: Identifier,
            drifted: false, // Just created/updated, so no drift
          });
        }

        return {
          newStatus: "ready",
          signalUpdates: {
            state: resourceProperties,
            resourceIdentifier: Identifier,
            drifted: false,
          },
        };
      }

      // Update request token in KV
      await kv.block.set({ key: REQUEST_TOKEN_KEY, value: NewRequestToken });

      return {
        newStatus: "in_progress",
        nextScheduleDelay: 10,
      };
    }

    // NEW: Always check for resource drift during sync
    if (resourceIdentifier) {
      // Fetch current AWS resource state
      const { ResourceDescription } = await client.send(
        new GetResourceCommand({
          TypeName: resolvedTypeName,
          Identifier: resourceIdentifier,
        }),
      );

      const actualState = JSON.parse(ResourceDescription?.Properties || "{}");
      const lastKnownState = (state as Record<string, any>) || {};

      // Detect drift between actual AWS state and last known state
      const driftDetected = !deepEqual(
        actualState,
        lastKnownState,
        nonUpdatablePropertyKeys,
      );
      const configChanged = configHash !== currentConfigHash;

      if (driftDetected || configChanged) {
        // Log drift information
        if (driftDetected && !configChanged) {
          logDrift(
            resolvedTypeName,
            resourceIdentifier,
            actualState,
            lastKnownState,
            nonUpdatablePropertyKeys,
          );
        }

        // Check if reconciliation is enabled
        const shouldReconcile =
          (input.block.config.reconcileOnDrift as boolean) !== false;

        if (!shouldReconcile && driftDetected && !configChanged) {
          // Drift detected but reconciliation disabled - just report it
          const driftedFields = getDriftedFields(
            actualState,
            lastKnownState,
            nonUpdatablePropertyKeys,
          );

          // Emit output for drift detection
          await events.emit({
            state: actualState,
            resourceIdentifier,
            drifted: true,
          });

          return {
            newStatus: "ready",
            customStatusDescription: `Drifted (${driftedFields.join(", ")})`,
            signalUpdates: {
              drifted: true,
            },
            // Don't update stored state - keep the original as baseline for drift detection
          };
        }

        // Generate patch to reconcile AWS state to desired config
        const patchOperations = generateJsonPatch(
          actualState, // current AWS state
          desiredState, // desired configuration
          nonUpdatablePropertyKeys,
          Object.keys(desiredState), // only patch properties user explicitly configured
        );

        if (patchOperations.length === 0) {
          // No changes needed, just update stored state
          // Update internal state in KV
          await kv.block.set({
            key: CONFIG_HASH_KEY,
            value: currentConfigHash,
          });

          // Check if we need to emit output for state change
          const stateChanged = !deepEqual(
            actualState,
            lastKnownState,
            nonUpdatablePropertyKeys,
          );
          if (stateChanged) {
            await events.emit({
              state: actualState,
              resourceIdentifier,
              drifted: false,
            });
          }

          return {
            newStatus: "ready",
            signalUpdates: {
              state: actualState,
              drifted: false,
            },
          };
        }

        // Apply reconciliation update
        const { ProgressEvent } = await client.send(
          new UpdateResourceCommand({
            TypeName: resolvedTypeName,
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

        // Store internal state in KV
        await kv.block.setMany([
          { key: CONFIG_HASH_KEY, value: currentConfigHash },
          { key: REQUEST_TOKEN_KEY, value: RequestToken },
        ]);

        return {
          newStatus: "in_progress",
          nextScheduleDelay: 10,
        };
      }

      // Update stored state even if no changes (for accurate drift detection)
      if (!deepEqual(actualState, lastKnownState, nonUpdatablePropertyKeys)) {
        // State changed but no drift (probably external non-configuration changes)
        await events.emit({
          state: actualState,
          resourceIdentifier,
          drifted: false,
        });

        return {
          newStatus: "ready",
          signalUpdates: {
            state: actualState,
            drifted: false,
          },
        };
      }
    }

    // Resource is in sync
    return { newStatus: "ready" };
  };

  const onDrain = async (
    input: EntityInput,
  ): Promise<EntityLifecycleCallbackOutput> => {
    const { app, block } = input;
    const { resourceIdentifier } = block.lifecycle?.signals || {};

    // Get internal state from KV
    const { value: requestToken } = await kv.block.get(REQUEST_TOKEN_KEY);

    // Nothing to clean up, we're good.
    if (!requestToken && !resourceIdentifier) {
      return { newStatus: "drained" };
    }

    const { region } = block.config;
    const client = createCloudControlClient(app, region);

    // Extract type name using options
    const resolvedTypeName =
      typeof opts.typeName === "string"
        ? opts.typeName
        : opts.typeName(block.config);

    // If we have a request token, we query for the status.
    if (requestToken) {
      const { ProgressEvent } = await client.send(
        new GetResourceRequestStatusCommand({ RequestToken: requestToken }),
      );

      const { OperationStatus, StatusMessage } = ProgressEvent!;

      if (OperationStatus === "FAILED") {
        console.log("Resource error: ", StatusMessage);
        // Clear internal state from KV
        await kv.block.delete([REQUEST_TOKEN_KEY]);
        return {
          newStatus: "failed",
          customStatusDescription: "Deletion failed, see logs",
        };
      }

      if (OperationStatus === "SUCCESS") {
        return { newStatus: "drained" };
      }

      return {
        newStatus: "draining",
        nextScheduleDelay: 10,
      };
    }

    const { ProgressEvent } = await client.send(
      new DeleteResourceCommand({
        TypeName: resolvedTypeName,
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
      return { newStatus: "drained" };
    }

    // Store request token in KV
    await kv.block.set({ key: REQUEST_TOKEN_KEY, value: RequestToken });

    return {
      newStatus: "draining",
      nextScheduleDelay: 10,
    };
  };

  return { onSync, onDrain };
}
