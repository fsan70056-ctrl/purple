"""Copy the Strudel packages (and their pure-JS dependencies) out of the repo's pnpm store
into backend/.strudel-runtime/node_modules, so Node can run them headlessly without
following pnpm junctions. Nothing is downloaded. Re-run safely."""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
REPO = BACKEND.parent
STORE = REPO / "node_modules" / ".pnpm"
DEST = BACKEND / ".strudel-runtime"
ROOTS = ["@strudel/core", "@strudel/mini", "@strudel/tonal", "@strudel/transpiler"]


def main() -> int:
    if not STORE.is_dir():
        print(f"pnpm store not found: {STORE}", file=sys.stderr)
        return 1
    names = [p.name for p in STORE.iterdir()]
    shutil.rmtree(DEST, ignore_errors=True)
    nm = DEST / "node_modules"
    nm.mkdir(parents=True)
    seen: set[str] = set()

    def add(name: str) -> None:
        if name in seen:
            return
        seen.add(name)
        prefix = name.replace("/", "+") + "@"
        folders = sorted(n for n in names if n.startswith(prefix))
        if not folders:
            print("missing", name)
            return
        src = STORE / folders[-1] / "node_modules" / name
        if not src.is_dir():
            print("no dir", name)
            return
        dst = nm / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("test", "bench", "*.map"))
        meta = json.loads((src / "package.json").read_text(encoding="utf-8"))
        # Bundlers prefer "module"; plain Node uses "main". Point main at the ESM build.
        if "module" in meta and "exports" not in meta:
            meta["main"] = meta["module"]
            (dst / "package.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        for dep in meta.get("dependencies", {}):
            add(dep)

    for root in ROOTS:
        add(root)
    shutil.copy2(HERE / "strudel_events.mjs", DEST / "strudel_events.mjs")
    (DEST / "package.json").write_text('{"type":"module","private":true}\n', encoding="utf-8")
    print(f"strudel runtime ready: {len(seen)} packages -> {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
