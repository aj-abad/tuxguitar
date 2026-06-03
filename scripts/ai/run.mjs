// Entrypoint for the AI test scripts. Registers the .ts resolve hook, then runs
// the requested converter. Keeps a single clean invocation with no node flags:
//
//   node scripts/ai/run.mjs china.tg 2
//   pnpm ai:tgx china.tg 2
//
// argv after the script name is forwarded to the converter unchanged.
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);

await import("./tg-to-tgx.ts");
