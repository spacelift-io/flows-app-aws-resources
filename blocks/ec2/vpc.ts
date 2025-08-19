import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-ec2-vpc.json";

export const vpc = buildBlock(schema, manifest["AWS::EC2::VPC"]);
