/**
 * 画面の中身とパスは信用できない入力。HTML に入れる文字列は、必ずこれを通す。
 * テンプレートの外で文字列を連結して HTML を作らない。
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
