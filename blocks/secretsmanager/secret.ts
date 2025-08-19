import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-secretsmanager-secret.json";

export const secret = buildBlock(
  schema,
  manifest["AWS::SecretsManager::Secret"],
);
