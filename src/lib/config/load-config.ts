import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type AppConfig, type AppEnvironment, appConfigSchema } from './config.schema';

export class InvalidConfigError extends Error {
  constructor(
    readonly configFilePath: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid configuration in ${configFilePath}:\n${issues.join('\n')}`);
    this.name = 'InvalidConfigError';
  }
}

export function resolveConfigFilePath(input: {
  appEnvironment: AppEnvironment;
  explicitConfigFilePath: string | undefined;
  projectRoot: string;
}): string {
  if (input.explicitConfigFilePath !== undefined) return path.resolve(input.explicitConfigFilePath);
  return path.join(input.projectRoot, 'config', `config.${input.appEnvironment}.json`);
}

export function parseConfig(configFilePath: string, rawConfig: unknown): AppConfig {
  const parseResult = appConfigSchema.safeParse(rawConfig);
  if (parseResult.success) return parseResult.data;
  const issues = parseResult.error.issues.map(
    (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new InvalidConfigError(configFilePath, issues);
}

export function loadConfigFile(configFilePath: string): AppConfig {
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(readFileSync(configFilePath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InvalidConfigError(configFilePath, [`  (file): ${reason}`]);
  }
  return parseConfig(configFilePath, rawConfig);
}
