import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-sqs-queuepolicy.json";

export const queuepolicy = buildBlock(
  schema,
  manifest["AWS::SQS::QueuePolicy"],
);
