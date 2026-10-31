import type { Prompter } from "./prompter.js";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  /** 端末で質問できるときだけ渡される */
  prompt?: Prompter;
}
