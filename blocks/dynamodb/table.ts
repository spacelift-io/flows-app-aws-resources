import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/aws-dynamodb-table.json";

export const table = buildBlock(schema, manifest["AWS::DynamoDB::Table"]);
