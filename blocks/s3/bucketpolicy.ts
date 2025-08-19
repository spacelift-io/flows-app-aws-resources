import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-s3-bucketpolicy.json";

export const bucketpolicy = buildBlock(
  schema,
  manifest["AWS::S3::BucketPolicy"],
);
