#!/usr/bin/env node
import { parseArgs } from "node:util";
import { isAbsolute } from "node:path";
import { closeHttpStack, readStackStateFile } from "../../frontend/e2e/global-teardown.ts";

const usage = "Usage: node --experimental-strip-types scripts/dev/close-http-e2e-stack.mjs --state /absolute/path/to/state.json";
let values;
try {
  ({ values } = parseArgs({ options: { state: { type: "string" }, help: { type: "boolean", short: "h" } }, strict: true, allowPositionals: false }));
} catch {
  console.error("HTTP E2E close: invalid arguments. " + usage);
  process.exit(1);
}
if (values.help) {
  console.log(usage);
} else {
  try {
    if (!values.state || !isAbsolute(values.state)) throw new Error("--state must name an absolute state-file path");
    const state = await readStackStateFile(values.state);
    if (state.version !== 4) throw new Error("This command closes HTTP v4 stacks only; other records are preserved");
    await closeHttpStack(state, values.state);
    console.log("HTTP_E2E_STACK_CLOSED");
  } catch (e) {
    const message = e && e.code === "ENOENT" ? "state or ownership receipt is missing; preserved" : e instanceof Error ? e.message : "close failed; records preserved";
    console.error("HTTP E2E close: " + message);
    process.exitCode = 1;
  }
}
