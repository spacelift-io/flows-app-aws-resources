interface PatchOperation {
  op: "add" | "remove" | "replace";
  path: string;
  value?: any;
}

/**
 * Generates a JSON Patch document (RFC 6902) by comparing two objects.
 * Only includes operations for properties that have actually changed.
 *
 * @param oldObj The original object
 * @param newObj The updated object
 * @param readOnlyKeys Optional array of keys to exclude from patch operations
 * @returns Array of patch operations
 */
export function generateJsonPatch(
  oldObj: Record<string, any>,
  newObj: Record<string, any>,
  readOnlyKeys?: string[],
): PatchOperation[] {
  const operations: PatchOperation[] = [];

  // Get all unique keys from both objects
  const allKeys = new Set([
    ...Object.keys(oldObj || {}),
    ...Object.keys(newObj || {}),
  ]);

  for (const key of allKeys) {
    // Skip read-only keys
    if (readOnlyKeys?.includes(key)) {
      continue;
    }

    const oldValue = oldObj?.[key];
    const newValue = newObj?.[key];

    // Property was removed
    if (oldValue !== undefined && newValue === undefined) {
      operations.push({
        op: "remove",
        path: `/${key}`,
      });
    }
    // Property was added
    else if (oldValue === undefined && newValue !== undefined) {
      operations.push({
        op: "add",
        path: `/${key}`,
        value: newValue,
      });
    }
    // Property was changed
    else if (
      oldValue !== undefined &&
      newValue !== undefined &&
      !deepEqual(oldValue, newValue)
    ) {
      operations.push({
        op: "replace",
        path: `/${key}`,
        value: newValue,
      });
    }
  }

  return operations;
}

/**
 * Deep equality comparison for primitive values, arrays, and objects.
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  return false;
}
