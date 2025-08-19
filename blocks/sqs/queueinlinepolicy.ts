import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-sqs-queueinlinepolicy.json";

export const queueinlinepolicy = buildBlock(
  schema,
  manifest["AWS::SQS::QueueInlinePolicy"],
);
