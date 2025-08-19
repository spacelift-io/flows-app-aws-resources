import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-cloudformation-stack.json";

export const stack = buildBlock(schema, manifest["AWS::CloudFormation::Stack"]);
