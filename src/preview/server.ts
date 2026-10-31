import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { inspectProject } from "../checks/status.js";
import type { Config } from "../config.js";
import { renderIndex, renderNotFound, renderScreenPage } from "./html.js";

export interface PreviewOptions {
  root: string;
  config: Config;
  /** 0 なら空いているポートを使う */
  port: number;
  /** 表示中に起きた想定外の失敗。利用者のブラウザには詳細を返さないので、ここで受ける */
  onError(error: unknown): void;
}

export interface PreviewServer {
  url: string;
  close(): Promise<void>;
}

export type StartResult = { ok: true; server: PreviewServer } | { ok: false; error: string };

// 画面の中身は信用できない入力なので、HTML は自分で作ったもの以外を動かさない。
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, HEADERS);
  response.end(body);
}

/**
 * ブラウザ経由で他のサイトから叩かれる（DNS rebinding）のを防ぐため、
 * Host が自分のアドレスのときだけ答える。
 */
function hostIsOurs(request: IncomingMessage, port: number): boolean {
  const host = request.headers.host;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

async function handle(request: IncomingMessage, response: ServerResponse, options: PreviewOptions) {
  const { language } = options.config;
  const url = new URL(request.url ?? "/", "http://localhost");
  const inspection = await inspectProject(options.root, options.config);
  const views = inspection.screens;
  if (url.pathname === "/") return send(response, 200, renderIndex(inspection, language));
  if (url.pathname === "/screen") {
    // 渡されたパスをファイルとして開かない。検査済みの画面の一覧から、同じ名前のものを探すだけ。
    const view = views.find((candidate) => candidate.screen === url.searchParams.get("file"));
    if (view) return send(response, 200, renderScreenPage(view, inspection, language));
  }
  return send(response, 404, renderNotFound(inspection, language));
}

/** 自分のマシンからだけ見られる場所で待ち受ける。 */
export function startPreview(options: PreviewOptions): Promise<StartResult> {
  return new Promise((resolve) => {
    // 実際のポートは待ち受けてから決まる（0 を指定したとき）。
    let port = options.port;
    const server = createServer((request, response) => {
      if (request.method !== "GET") return send(response, 405, "");
      if (!hostIsOurs(request, port)) return send(response, 403, "");
      handle(request, response, options).catch((error: unknown) => {
        options.onError(error);
        send(response, 500, "");
      });
    });
    server.once("error", (error) => resolve({ ok: false, error: error.message }));
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) port = address.port;
      const close = () =>
        new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        });
      resolve({ ok: true, server: { url: `http://127.0.0.1:${port}/`, close } });
    });
  });
}
