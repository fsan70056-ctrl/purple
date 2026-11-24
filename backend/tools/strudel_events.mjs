// Query a Strudel pattern headlessly (no browser) and print its onset events as JSON.
// Runs inside backend/.strudel-runtime (see build_strudel_runtime.py).
// Usage: node strudel_events.mjs <seconds>   (Strudel code on stdin). Times are seconds:
// .cpm(x) is fast(x/60) in this Strudel build, so one query unit is one second.
import * as core from "@strudel/core";
import * as mini from "@strudel/mini";
import * as tonal from "@strudel/tonal";
import { transpiler } from "@strudel/transpiler";
import { readFileSync } from "node:fs";

const cycles = Number(process.argv[2]);
await core.evalScope(core, mini, tonal);
const { pattern } = await core.evaluate(readFileSync(0, "utf8"), transpiler);
const out = [];
for (const h of pattern.queryArc(0, cycles)) {
  if (!h.hasOnset()) continue;
  const v = h.value && typeof h.value === "object" ? h.value : { value: h.value };
  out.push({ start: h.whole.begin.valueOf(), end: h.whole.end.valueOf(), v });
}
process.stdout.write(JSON.stringify(out));
process.exit(0);
