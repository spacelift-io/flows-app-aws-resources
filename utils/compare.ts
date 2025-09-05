/**
 * Deep equality comparison for objects, excluding specified keys
 * Used to compare AWS resource states while ignoring read-only properties
 */
export function deepEqual(a: any, b: any, excludeKeys?: string[]): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx], excludeKeys));
  }

  if (typeof a === "object" && typeof b === "object") {
    // Get all keys from both objects, excluding specified keys
    const keysA = Object.keys(a).filter((key) => !excludeKeys?.includes(key));
    const keysB = Object.keys(b).filter((key) => !excludeKeys?.includes(key));

    // Sort keys to ensure consistent comparison
    keysA.sort();
    keysB.sort();

    if (keysA.length !== keysB.length) return false;

    // Check if all keys match
    if (!keysA.every((key, idx) => key === keysB[idx])) return false;

    // Recursively compare values for each key
    return keysA.every((key) => deepEqual(a[key], b[key], excludeKeys));
  }

  return false;
}

/**
 * Logs drift information for debugging and monitoring
 */
export function logDrift(
  typeName: string,
  resourceId: string,
  actualState: Record<string, any>,
  lastKnownState: Record<string, any>,
  excludeKeys?: string[],
): void {
  console.log(`🔄 Resource drift detected for ${typeName}:${resourceId}`);

  // Find the fields that changed
  const changedFields = getDriftedFields(
    actualState,
    lastKnownState,
    excludeKeys,
  );

  if (changedFields.length > 0) {
    console.log(`Changed fields: ${changedFields.join(", ")}`);
  }
}

/**
 * Returns the list of fields that have drifted
 */
export function getDriftedFields(
  actualState: Record<string, any>,
  lastKnownState: Record<string, any>,
  excludeKeys?: string[],
): string[] {
  const allKeys = new Set([
    ...Object.keys(actualState || {}),
    ...Object.keys(lastKnownState || {}),
  ]);

  const changedFields: string[] = [];

  for (const key of allKeys) {
    if (excludeKeys?.includes(key)) continue;

    const actualValue = actualState?.[key];
    const lastKnownValue = lastKnownState?.[key];

    if (!deepEqual(actualValue, lastKnownValue)) {
      changedFields.push(key);
    }
  }

  return changedFields;
}
