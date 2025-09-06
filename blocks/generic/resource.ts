import { AppBlock, EventInput, lifecycle } from "@slflows/sdk/v1";
import { createCloudControlHandlers } from "../../utils/cloudControl";
import { getNonUpdatableProperties } from "../../utils/cloudformation";

// Create handlers using the consolidated cloudControl factory
const { onSync, onDrain } = createCloudControlHandlers({
  typeName: (config) => config.typeName as string,
  getDesiredState: (config) => config.state as Record<string, any>,
  getNonUpdatableProperties: getNonUpdatableProperties,
});

export const resource: AppBlock = {
  name: "Resource",
  description:
    "Manage any AWS resource [supported by CloudControl](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html) by specifying the type name (eg. AWS::EC2::Instance) and desired state. If you're not super familiar with AWS resource APIs, we suggest using the AI agent to help you get the configuration right.",
  category: "Generic",

  config: {
    reconcileOnDrift: {
      name: "Reconcile on Drift",
      description:
        "When enabled, automatically corrects resource drift by updating AWS resources to match desired configuration. When disabled, drift is detected and reported but resources are not automatically updated.",
      type: "boolean",
      required: true,
      default: true,
    },
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
        "The CloudFormation resource type name (e.g., `AWS::S3::Bucket`). See [supported resources](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html).",
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

  inputs: {
    sync: {
      name: "Sync",
      description:
        "Triggers a sync operation to check and reconcile resource state",
      config: {},
      onEvent: async (_input: EventInput) => {
        lifecycle.sync();
      },
    },
  },

  outputs: {
    default: {
      name: "State Changed",
      description: "Emitted when the resource state changes",
      type: {
        type: "object",
        properties: {
          state: {
            type: "object",
            description: "The new resource state",
          },
          resourceIdentifier: {
            type: "string",
            description: "The resource identifier",
          },
          drifted: {
            type: "boolean",
            description: "Whether the resource has drifted from desired state",
          },
        },
      },
    },
  },

  signals: {
    state: {
      name: "Current State",
      description: "The current state of the resource",
    },
    resourceIdentifier: {
      name: "Resource Identifier",
      description: "The unique identifier for the AWS resource",
    },
    drifted: {
      name: "Drifted",
      description: "Whether the resource has drifted from desired state",
    },
  },

  onSync,
  onDrain,
};
