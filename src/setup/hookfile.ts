import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { git } from "../repo/git.js";

export const HOOK_START = "# tidyspec:start";
export const HOOK_END = "# tidyspec:end";

// tidyspec が入っていないチェックアウトでコミットを全部止めるのは酷なので、その場合は知らせて通す。
// tidyspec が動いて問題を見つけたとき（終了コード 1 と 2）は、そのコードでコミットを止める。
export const HOOK_SCRIPT = `#!/bin/sh
${HOOK_START} (managed by "tidyspec init"; run it again to update)
root="$(git rev-parse --show-toplevel)"
if [ -x "$root/node_modules/.bin/tidyspec" ]; then
  "$root/node_modules/.bin/tidyspec" check || exit $?
elif command -v tidyspec >/dev/null 2>&1; then
  tidyspec check || exit $?
else
  echo "tidyspec: not installed, so the spec check was skipped (npm install --save-dev tidyspec)" >&2
fi
${HOOK_END}
`;

export type HookState =
  /** core.hooksPath が設定されている。husky や lefthook など、別の仕組みが管理している */
  | { kind: "custom-hooks-path"; value: string }
  | { kind: "none"; file: string }
  | { kind: "ours"; file: string; content: string }
  /** 自分たちの目印が無い既存のフック。触らない */
  | { kind: "foreign"; file: string };

export async function inspectHook(root: string): Promise<HookState> {
  const configured = await git(root, ["config", "--get", "core.hooksPath"]);
  const value = configured.stdout.trim();
  if (configured.code === 0 && value !== "") return { kind: "custom-hooks-path", value };

  const where = await git(root, ["rev-parse", "--git-path", "hooks/pre-commit"]);
  if (where.code !== 0) throw new Error(`git rev-parse failed (exit ${where.code})`);
  const file = path.resolve(root, where.stdout.trim());

  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { kind: "none", file };
    throw error;
  }
  return content.includes(HOOK_START) ? { kind: "ours", file, content } : { kind: "foreign", file };
}

export async function writeHook(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, HOOK_SCRIPT);
  await chmod(file, 0o755);
}
