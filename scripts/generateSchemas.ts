#!/usr/bin/env node

import {
  CloudFormationClient,
  DescribeTypeCommand,
} from "@aws-sdk/client-cloudformation";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import manifest from "../manifest.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Script to fetch CloudFormation schemas and generate blocks for resources defined in manifest.json
 */
async function generateSchemas() {
  const client = new CloudFormationClient({});
  const schemasDir = resolve(__dirname, "../schemas");
  const blocksDir = resolve(__dirname, "../blocks");

  // Ensure directories exist
  mkdirSync(schemasDir, { recursive: true });
  mkdirSync(blocksDir, { recursive: true });

  const generatedBlocks: Array<{
    typeName: string;
    service: string;
    resource: string;
  }> = [];

  for (const [typeName] of Object.entries(manifest)) {
    console.log(`Processing ${typeName}...`);

    try {
      // Fetch schema
      const command = new DescribeTypeCommand({
        Type: "RESOURCE",
        TypeName: typeName,
      });

      const response = await client.send(command);

      if (response.Schema) {
        const schema = JSON.parse(response.Schema);

        // Save schema
        const schemaFilename =
          typeName.toLowerCase().replace(/::/g, "-") + ".json";
        const schemaFilepath = resolve(schemasDir, schemaFilename);
        writeFileSync(schemaFilepath, JSON.stringify(schema, null, 2));
        console.log(`✓ Schema saved to ${schemaFilename}`);

        // Generate block
        const parts = typeName.split("::");
        const service = parts[1].toLowerCase();
        const resource = parts[2].toLowerCase();

        const serviceDir = resolve(blocksDir, service);
        mkdirSync(serviceDir, { recursive: true });

        const blockFilename = `${resource}.ts`;
        const blockFilepath = resolve(serviceDir, blockFilename);

        const blockContent = generateBlockContent(typeName, schemaFilename);
        writeFileSync(blockFilepath, blockContent);
        console.log(`✓ Block saved to ${service}/${blockFilename}`);

        // Track generated block
        generatedBlocks.push({ typeName, service, resource });
      } else {
        console.warn(`⚠ No schema found for ${typeName}`);
      }
    } catch (error) {
      console.error(`✗ Error processing ${typeName}:`, error);

      // If API call fails but we have existing blocks, still include them
      const parts = typeName.split("::");
      const service = parts[1].toLowerCase();
      const resource = parts[2].toLowerCase();

      generatedBlocks.push({ typeName, service, resource });
    }
  }

  // Generate index file
  generateIndexFile(blocksDir, generatedBlocks);
}

/**
 * Generates the TypeScript content for a block file
 */
function generateBlockContent(
  typeName: string,
  schemaFilename: string,
): string {
  const parts = typeName.split("::");
  const resource = parts[2].toLowerCase();
  const exportName = resource;

  return `import { buildBlock } from "../../utils/blockBuilder";
import manifest from "../../manifest.json";
import schema from "../../schemas/${schemaFilename}";

export const ${exportName} = buildBlock(schema, manifest["${typeName}"]);
`;
}

/**
 * Generates the index.ts file that exports all blocks
 */
function generateIndexFile(
  blocksDir: string,
  generatedBlocks: Array<{
    typeName: string;
    service: string;
    resource: string;
  }>,
) {
  const indexPath = resolve(blocksDir, "index.ts");

  // Generate imports
  const imports = generatedBlocks
    .map(
      ({ service, resource }) =>
        `import { ${resource} } from "./${service}/${resource}";`,
    )
    .join("\n");

  // Generate exports dictionary
  const exportEntries = generatedBlocks
    .map(
      ({ service, resource }) =>
        `  ${service}${resource.charAt(0).toUpperCase()}${resource.slice(1)}: ${resource},`,
    )
    .join("\n");

  const indexContent = `${imports}
import { genericResource } from "./genericResource";

/**
 * Dictionary of all available blocks
 * Key: block identifier (for programmatic access)
 * Value: block definition
 */
export const blocks = {
${exportEntries}
  genericResource: genericResource,
} as const;
`;

  writeFileSync(indexPath, indexContent);
  console.log(`✓ Index file generated with ${generatedBlocks.length} blocks`);
}

generateSchemas().catch(console.error);
