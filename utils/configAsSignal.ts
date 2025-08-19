import { AppBlockSignal, AppConfigField } from "@slflows/sdk/v1";

export function configAsSignals(
  config: Record<string, AppConfigField>,
): Record<string, AppBlockSignal> {
  return Object.fromEntries(
    Object.entries(config).map(
      ([key, { name, description = "", sensitive }]) => [
        key,
        { name, description, sensitive },
      ],
    ),
  );
}
