import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-sns-topicinlinepolicy.json";

export const topicinlinepolicy = buildBlock(
  schema,
  manifest["AWS::SNS::TopicInlinePolicy"],
);
