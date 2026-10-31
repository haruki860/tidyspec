export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** 端末で質問するための口。端末が無いとき（エージェント、CI）は渡されない。 */
export interface Prompter {
  select<T extends string>(question: string, choices: readonly Choice<T>[], fallback: T): Promise<T>;
  confirm(question: string, fallback: boolean): Promise<boolean>;
  text(question: string, fallback: string): Promise<string>;
}
