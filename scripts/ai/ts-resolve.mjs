// Minimal ESM resolve hook: lets plain `node` import the repo's extensionless
// TypeScript modules in shared/ (e.g. `import "./model"` -> `./model.ts`).
// Vite/vitest/nuxt resolve these for us in the app; standalone node does not.
// Node 24 strips the TS types natively once the specifier points at the .ts file.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExt = /\.[cm]?[jt]s$/i.test(specifier);
  if (relative && !hasExt) {
    try {
      const url = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(specifier + ".ts", context);
    } catch {
      // fall through to default resolution
    }
  }
  return next(specifier, context);
}
