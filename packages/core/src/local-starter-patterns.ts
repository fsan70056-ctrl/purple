import type { ShowcasePattern } from "./showcase-patterns.ts";

/**
 * Starters for the local Chinese build, which loads no sample packs (their
 * licences are unclear). They use only built-in synthesizer voices so that
 * every piece plays with the engine's own oscillators.
 */
export const LOCAL_STARTER_PATTERNS: readonly ShowcasePattern[] = [
  {
    title: "夜班律动",
    code: `stack(
  note("<c2 c2 g1 bb1>").s("sawtooth").lpf(sine.range(300, 1200).slow(8)).gain(.8),
  note("c4 [eb4 g4] bb3 [g4 ~]").s("triangle").room(.4).delay(.125).gain(.5)
).cpm(126/4)`,
  },
  {
    title: "回声花园",
    code: `stack(
  n("<4 [3@3 4] [<2 0> ~@16] ~>").scale("D4:minor").s("sawtooth").room(.5).gain(.4),
  n("[0 [~ 0] 4 [3 2] [0 ~] [0 ~] <0 2> ~]/2").scale("D2:minor").s("sawtooth,triangle").lpf(800)
).cpm(90/4)`,
  },
  {
    title: "棱镜拨弦",
    code: `stack(
  n("0 [2 4] <3 5> [~ <4 1>]".add("<0 [0,2,4]>")).scale("C5:minor").s("triangle").room(.4).delay(.125),
  note("c2 [eb3,g3]".add("<0 <1 -1>>")).adsr("[.1 0]:.2:[1 0]").s("sawtooth").lpf(600).room(.5)
).cpm(96/4)`,
  },
];
