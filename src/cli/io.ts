import type { Prompter } from "./prompter.js";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  /** 端末で質問できるときだけ渡される */
  prompt?: Prompter;
  /**
   * 長く動くコマンド（preview）が、止める合図（Ctrl-C など）を待つための約束。無ければそのコマンドは動けない。
   * 呼ばれたときだけ合図を受け付ける（他のコマンドで Ctrl-C の既定の動きを変えないため）。
   */
  waitForInterrupt?: () => Promise<void>;
}
