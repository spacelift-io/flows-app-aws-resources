interface PatchOperation {
  op: "add" | "remove" | "replace";
  path: string;
  value?: any;
}

/**
 * Generates a JSON Patch document (RFC 6902) by comparing two objects.
 * Only includes operations for properties that have actually changed.
 *
 * @param oldObj The original object (current AWS state)
 * @param newObj The updated object (desired config state)
 * @param readOnlyKeys Optional array of keys to exclude from patch operations
 * @param userConfigKeys Optional array of keys that user explicitly configured (prevents patching auto-generated values)
 * @returns Array of patch operations
 */
export function generateJsonPatch(
  oldObj: Record<string, any>,
  newObj: Record<string, any>,
  readOnlyKeys?: string[],
  userConfigKeys?: string[],
): PatchOperation[] {
  const operations: PatchOperation[] = [];

  // Only consider keys that are either in the desired config or explicitly configured by user
  const allKeys = new Set([
    ...Object.keys(newObj || {}), // Properties user wants
    ...(userConfigKeys || []), // Properties user explicitly configured (even if now undefined)
  ]);

  for (const key of allKeys) {
    // Skip read-only keys
    if (readOnlyKeys?.includes(key)) {
      continue;
    }

    const oldValue = oldObj?.[key];
    const newValue = newObj?.[key];

    // Property was removed (only if user had explicitly set it before)
    if (
      oldValue !== undefined &&
      newValue === undefined &&
      userConfigKeys?.includes(key)
    ) {
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
