import type { Config } from "../config.js";
import { startPreview } from "../preview/server.js";
import type { Io } from "./io.js";

export const DEFAULT_PREVIEW_PORT = 4321;

export type PortResult = { ok: true; port: number } | { ok: false; error: string };

/** --port の値を検査する。無ければ既定。0 は「空いているポート」。 */
export function parsePort(value: string | undefined): PortResult {
  if (value === undefined) return { ok: true, port: DEFAULT_PREVIEW_PORT };
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) {
    return {
      ok: false,
      error: `--port must be a number from 0 to 65535, not ${JSON.stringify(value)}`,
    };
  }
  return { ok: true, port };
}

/** 画面をブラウザで見られるようにする。止める合図が来るまで動き続ける。 */
export async function runPreview(
  root: string,
  config: Config,
  context: { io: Io; port: number },
): Promise<number> {
  const { io, port } = context;
  if (io.waitForInterrupt === undefined) {
    io.err("tidyspec: preview keeps running until it is stopped, so it needs a terminal process");
    return 2;
  }
  const started = await startPreview({
    root,
    config,
    port,
    onError: (error) =>
      io.err(`tidyspec: ${error instanceof Error ? error.message : String(error)}`),
  });
  if (!started.ok) {
    io.err(`tidyspec: cannot start the preview: ${started.error}`);
    return 2;
  }
  io.out(`Preview: ${started.server.url}\nPress Ctrl-C to stop.`);
  await io.waitForInterrupt();
  await started.server.close();
  return 0;
}
