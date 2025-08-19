import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-ssm-parameter.json";

export const parameter = buildBlock(schema, manifest["AWS::SSM::Parameter"]);
