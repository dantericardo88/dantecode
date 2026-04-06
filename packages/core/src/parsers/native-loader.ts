import { createRequire } from "node:module";
import { getSafeModulePath } from "../runtime-path.js";

let _require: NodeRequire | undefined;

function getRequire(): NodeRequire {
  if (!_require) {
    _require = createRequire(getSafeModulePath());
  }
  return _require;
}

export class OptionalNativeModuleError extends Error {
  constructor(moduleName: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Optional native module "${moduleName}" is unavailable: ${detail}`);
    this.name = "OptionalNativeModuleError";
  }
}

export function loadOptionalModule<T>(
  moduleName: string,
  options: { preferDefault?: boolean } = {},
): T {
  try {
    const loaded = getRequire()(moduleName);
    const preferDefault = options.preferDefault ?? true;

    if (
      preferDefault &&
      loaded &&
      typeof loaded === "object" &&
      "default" in loaded &&
      loaded.default !== undefined
    ) {
      return loaded.default as T;
    }

    return loaded as T;
  } catch (error) {
    throw new OptionalNativeModuleError(moduleName, error);
  }
}
