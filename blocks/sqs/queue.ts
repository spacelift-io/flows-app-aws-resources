import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-sqs-queue.json";

export const queue = buildBlock(schema, manifest["AWS::SQS::Queue"]);
