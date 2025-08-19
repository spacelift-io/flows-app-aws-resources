import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-sns-topic.json";

export const topic = buildBlock(schema, manifest["AWS::SNS::Topic"]);
