# Third-party notices

Purple-authored source code is licensed under the MIT License in `LICENSE`.
The application bundles separately copyrighted dependencies under their own
licenses; those license grants are not replaced by Purple's MIT license.

## GNU Affero General Public License components

The distributed application bundle incorporates the following packages under
the GNU Affero General Public License, version 3 or later:

- `@kabelsalat/core`, `@kabelsalat/lib`, and `@kabelsalat/web`
- `@strudel/core`, `@strudel/draw`, `@strudel/mini`, `@strudel/tonal`,
  `@strudel/transpiler`, `@strudel/web`, and `@strudel/webaudio`
- `superdough` and `supradough`

The complete AGPL text is in `LICENSE-AGPL-3.0-or-later`. The exact dependency
versions are recorded in `pnpm-lock.yaml`. Source for the corresponding Purple
release, including the build instructions and lockfile, is available from the
[Purple repository](https://github.com/ferdousbhai/purple). Upstream Strudel
source is available from the
[Strudel repository](https://codeberg.org/uzu/strudel).

The packaged application's license metadata lists both MIT and
AGPL-3.0-or-later to reflect this combination. This does not relicense
separately identifiable Purple-authored MIT files; redistributors remain
responsible for satisfying the licenses of the combined artifact.

## Bundled font

The application bundle embeds the JetBrains Mono variable webfont, distributed
through `@fontsource-variable/jetbrains-mono`:

> Copyright 2020 The JetBrains Mono Project Authors
> (https://github.com/JetBrains/JetBrainsMono)

JetBrains Mono is licensed under the SIL Open Font License, Version 1.1. The
full license text ships inside the package at
`node_modules/@fontsource-variable/jetbrains-mono/LICENSE` and is also
available at https://openfontlicense.org.

## Other dependencies

Other JavaScript dependencies retain the licenses declared in their package
metadata. Their exact versions and resolved sources are fixed by
`pnpm-lock.yaml`.

## Local song backend (optional, `backend/`; not part of the web bundle)

The Python backend that sings lyrics locally uses these packages, installed from PyPI
into a local virtual environment (not committed): FastAPI (MIT), Uvicorn (BSD-3-Clause),
NumPy (BSD-3-Clause), ONNX Runtime (MIT), PyYAML (MIT) and pypinyin (MIT).

It reads two **voice models that are NOT part of this repository and must not be committed
or redistributed from it**; they stay on the local machine under `voice-lab/`:

- Voicebank **绮萱 (Qixuan) v2.7.0** for DiffSinger/OpenUtau. Outputs may be used personally and
  commercially, but a public release must state that the vocals are AI-synthesized and credit
  "绮萱" and "DiffSinger". The model weights must not be modified, converted or distilled, and
  outputs must not be used to train voice models. Redistribution is only allowed complete,
  unmodified and free of charge. See the `Terms_of_Use` file shipped with the voicebank.
- Vocoder **PC-NSF-HiFiGAN 44.1 kHz (2025.02)** by OpenVPI, **CC BY-NC-SA 4.0** (non-commercial,
  attribution, share-alike).

Generated WAV files carry an "AI-synthesized vocal" note in their metadata. This build is for
personal research only.
