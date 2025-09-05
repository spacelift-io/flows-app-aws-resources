import { AppBlock, AppConfigField } from "@slflows/sdk/v1";
import { createCloudControlHandlers } from "./cloudControl";

interface ResourceOverrides {
  blockName?: string;
  category?: string;
  description?: string;
  fieldNames?: Record<string, string>;
}

interface CloudFormationSchema {
  typeName: string;
  properties: Record<string, any>;
  definitions?: Record<string, any>;
  createOnlyProperties?: string[];
  readOnlyProperties?: string[];
  writeOnlyProperties?: string[];
  required?: string[];
  description?: string;
}

/**
 * Converts CapitalCase property names to human-readable names
 * e.g., "EnableDnsHostnames" -> "Enable Dns Hostnames"
 */
function inferDisplayName(propName: string): string {
  return (
    propName
      // Insert space before capital letters (except first one)
      .replace(/([A-Z])/g, " $1")
      .trim()
  );
}

/**
 * Resolves JSON Schema $ref to actual definition
 */
function resolveRef(ref: string, definitions: Record<string, any>): any {
  if (ref.startsWith("#/definitions/")) {
    const defName = ref.replace("#/definitions/", "");
    return definitions[defName];
  }
  throw new Error(`Unsupported ref format: ${ref}`);
}

/**
 * Converts CloudFormation property to JSON Schema or simple type
 */
function mapCloudFormationType(
  cfProperty: any,
  definitions: Record<string, any> = {},
):
  | "string"
  | "boolean"
  | "number"
  | ["string"]
  | ["number"]
  | Record<string, any> {
  // Handle $ref
  if (cfProperty.$ref) {
    const resolved = resolveRef(cfProperty.$ref, definitions);
    return resolved; // Return the full JSON Schema object
  }

  // Handle oneOf - choose the array option if available, otherwise the first option
  if (cfProperty.oneOf) {
    const arrayOption = cfProperty.oneOf.find(
      (option: any) => option.type === "array",
    );
    if (arrayOption) {
      return mapCloudFormationType(arrayOption, definitions);
    }
    // Fallback to first option
    return mapCloudFormationType(cfProperty.oneOf[0], definitions);
  }

  // Simple types
  if (cfProperty.type === "string") return "string";
  if (cfProperty.type === "boolean") return "boolean";
  if (cfProperty.type === "number" || cfProperty.type === "integer")
    return "number";

  // Arrays
  if (cfProperty.type === "array") {
    if (cfProperty.items?.$ref) {
      // Array of complex objects - return full JSON Schema with resolved refs
      const itemSchema = resolveRef(cfProperty.items.$ref, definitions);
      return {
        type: "array",
        items: itemSchema,
        description: cfProperty.description || "",
      };
    }
    if (cfProperty.items?.type === "string") return ["string"];
    if (cfProperty.items?.type === "number") return ["number"];
    // For other complex array types, return the full schema
    return {
      type: "array",
      items: cfProperty.items || {},
      description: cfProperty.description || "",
    };
  }

  // Complex objects - return as JSON Schema
  if (cfProperty.type === "object" || cfProperty.properties) {
    return cfProperty; // Return the full JSON Schema object
  }

  return "string"; // fallback for other types
}

/**
 * Builds a dynamic AppBlock from CloudFormation schema and overrides
 */
export function buildBlock(
  schema: CloudFormationSchema,
  overrides: ResourceOverrides,
): AppBlock {
  const typeName = schema.typeName;

  // Extract metadata
  const parts = typeName.split("::");
  const category = overrides.category || parts[1];
  const resourceName = parts[2];
  const name =
    overrides.blockName ||
    (overrides.fieldNames || {})[resourceName] ||
    `${category} ${resourceName}`;
  const description =
    overrides.description || schema.description || `AWS ${typeName} resource`;

  // Build config (writable properties only)
  const config: Record<string, AppConfigField> = {};

  // Sort properties to put required ones first
  const sortedProperties = Object.entries(schema.properties).sort(
    ([propNameA], [propNameB]) => {
      const isRequiredA = (schema.required || []).includes(propNameA);
      const isRequiredB = (schema.required || []).includes(propNameB);

      if (isRequiredA && !isRequiredB) return -1;
      if (!isRequiredA && isRequiredB) return 1;
      return propNameA.localeCompare(propNameB);
    },
  );

  for (const [propName, propSchema] of sortedProperties) {
    const isReadOnly = schema.readOnlyProperties?.includes(
      `/properties/${propName}`,
    );
    const isCreateOnly = schema.createOnlyProperties?.includes(
      `/properties/${propName}`,
    );
    const isWriteOnly = schema.writeOnlyProperties?.includes(
      `/properties/${propName}`,
    );
    const displayName =
      (overrides.fieldNames || {})[propName] || inferDisplayName(propName);
    const required = (schema.required || []).includes(propName);

    // Only include writable properties in config
    if (!isReadOnly) {
      config[propName] = {
        name: displayName,
        description: propSchema.description || "",
        type: mapCloudFormationType(propSchema, schema.definitions),
        required,
        fixed: isCreateOnly,
        sensitive: isWriteOnly,
      };
    }
  }

  // Extract read-only and create-only property keys for handlers
  const readOnlyPropertyKeys = (schema.readOnlyProperties || []).map(
    (prop: string) => prop.replace("/properties/", ""),
  );
  const createOnlyPropertyKeys = (schema.createOnlyProperties || []).map(
    (prop: string) => prop.replace("/properties/", ""),
  );

  // Create handlers
  const { onSync, onDrain } = createCloudControlHandlers({
    typeName,
    getDesiredState: (config) => {
      const { region, reconcileOnDrift, ...desiredState } = config;
      return desiredState;
    },
    getNonUpdatableProperties: [
      ...readOnlyPropertyKeys,
      ...createOnlyPropertyKeys,
    ],
  });

  return {
    name,
    description,
    category,
    config: {
      reconcileOnDrift: {
        name: "Reconcile on Drift",
        description:
          "When enabled, automatically corrects resource drift by updating AWS resources to match desired configuration. When disabled, drift is detected and reported but resources are not automatically updated.",
        type: "boolean",
        required: true,
        default: true,
      },
      region: {
        name: "Region",
        description: "The AWS region for provisioning the resource.",
        type: "string",
        required: true,
        fixed: true,
      },
      ...Object.fromEntries(
        Object.entries(config).sort(([, a], [, b]) => {
          // Required fields first, then alphabetical
          if (a.required && !b.required) return -1;
          if (!a.required && b.required) return 1;
          return 0;
        }),
      ),
    },
    onSync,
    onDrain,
    signals: {
      state: {
        name: "Current State",
        description: "The current state of the resource from AWS",
      },
      resourceIdentifier: {
        name: "Resource Identifier",
        description: "The unique identifier for the AWS resource.",
      },
    },
  };
}
