import { createHash } from "crypto";

export function calculateConfigHash(config: Record<string, any>): string {
  const sortedConfig = Object.keys(config)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = config[key];
        return acc;
      },
      {} as Record<string, any>,
    );

  const configString = JSON.stringify(sortedConfig);
  return createHash("sha256").update(configString).digest("hex");
}
