import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-sns-topicpolicy.json";

export const topicpolicy = buildBlock(
  schema,
  manifest["AWS::SNS::TopicPolicy"],
);
