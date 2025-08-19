import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-s3-bucket.json";

export const bucket = buildBlock(schema, manifest["AWS::S3::Bucket"]);
