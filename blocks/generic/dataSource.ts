import {
  AppBlock,
  EntityInput,
  EntityLifecycleCallbackOutput,
} from "@slflows/sdk/v1";
import { createCloudControlClient } from "../../utils/cloudControl";
import { GetResourceCommand } from "@aws-sdk/client-cloudcontrol";

export const dataSource: AppBlock = {
  name: "Data Source",
  description:
    "Query and expose as a signal the current state of any AWS resource [supported by CloudControl](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html). Specify the resource type name and identifier to monitor the resource state.",
  category: "Generic",

  config: {
    region: {
      name: "Region",
      description: "The AWS region where the resource is located",
      type: "string",
      required: true,
    },
    typeName: {
      name: "Resource Type Name",
      description:
        "The CloudFormation resource type name (e.g., `AWS::S3::Bucket`, `AWS::EC2::Instance`). See [supported resources](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html).",
      type: "string",
      required: true,
    },
    resourceIdentifier: {
      name: "Resource Identifier",
      description:
        "The unique identifier for the AWS resource (e.g., bucket name, instance ID)",
      type: "string",
      required: true,
    },
  },

  signals: {
    state: {
      name: "Current State",
      description: "The current state of the AWS resource",
    },
  },

  onSync: async (
    input: EntityInput,
  ): Promise<EntityLifecycleCallbackOutput> => {
    const { app, block } = input;
    const { region, typeName, resourceIdentifier } = block.config;

    try {
      const client = createCloudControlClient(app, region as string);

      const { ResourceDescription } = await client.send(
        new GetResourceCommand({
          TypeName: typeName as string,
          Identifier: resourceIdentifier as string,
        }),
      );

      const currentState = JSON.parse(ResourceDescription?.Properties || "{}");

      return {
        newStatus: "ready",
        signalUpdates: { state: currentState },
      };
    } catch (error) {
      console.error("Error fetching resource state:", error);
      return {
        newStatus: "failed",
        customStatusDescription: "Failed to fetch resource state, see logs",
      };
    }
  },
};
