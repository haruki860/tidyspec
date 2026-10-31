export const LANGUAGES = ["en", "ja"] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value);
}

export const SECTION_KEYS = ["spec", "design", "code", "data"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** 画面ファイルの見出し。言語ごとに決まっていて、エージェントは名前を変えない。 */
export const HEADINGS: Record<Language, Record<SectionKey, string>> = {
  en: { spec: "Spec", design: "Design", code: "Code", data: "Data" },
  ja: { spec: "仕様", design: "設計", code: "コード", data: "データ" },
};

/** 見出しの文字列から、どのセクションかを引く。決まった見出しでなければ undefined。 */
export function sectionOf(language: Language, heading: string): SectionKey | undefined {
  return SECTION_KEYS.find((key) => HEADINGS[language][key] === heading);
}
