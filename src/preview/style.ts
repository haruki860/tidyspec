/**
 * プレビューの見た目。外部のフォントや画像は読み込まない（CSP で禁止していて、ネットが無くても同じに見える）。
 * 色は変数にまとめ、ダークモードは変数だけを差し替える。
 */
export const STYLE = `
:root{
  --bg:#fff;--panel:#fafafa;--text:#171717;--muted:#6b6b6b;--line:#e8e8e8;
  --accent:#0d9373;--accent-bg:#e7f6f1;--warn:#b45309;--warn-bg:#fef3e2;
  --error:#b3261e;--error-bg:#fdecea;--code-bg:#f3f3f3;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0b0b0c;--panel:#111113;--text:#ededed;--muted:#9a9a9f;--line:#232326;
  --accent:#3ecf9f;--accent-bg:#0f2a22;--warn:#f0b35a;--warn-bg:#2a1f0c;
  --error:#ff8a80;--error-bg:#2c1210;--code-bg:#1a1a1d;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.shell{display:grid;grid-template-columns:268px minmax(0,1fr)}
.side{position:sticky;top:0;height:100vh;overflow:auto;padding:1.5rem 1rem;background:var(--panel);border-right:1px solid var(--line)}
.brand{display:block;font:600 1.05rem var(--mono);letter-spacing:-.01em;padding:0 .5rem 1.25rem}
.brand span{color:var(--accent)}
.group{font-size:.72rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:0 .5rem .4rem}
.nav+.group{margin-top:1.1rem}
.nav a{display:flex;align-items:center;gap:.6rem;padding:.4rem .5rem;border-radius:8px;font-size:.92rem;color:var(--muted)}
.nav a:hover{background:var(--code-bg);color:var(--text)}
.nav a[aria-current=page]{background:var(--accent-bg);color:var(--accent);font-weight:600}
.dot{flex:none;width:.5rem;height:.5rem;border-radius:50%;background:var(--accent)}
.dot.warn{background:var(--warn)}
.main{display:grid;grid-template-columns:minmax(0,44rem) 13rem;gap:3rem;justify-content:center;padding:3rem 2rem 6rem}
.eyebrow{font-size:.85rem;font-weight:600;color:var(--accent);margin:0 0 .4rem}
h1{font-size:2rem;line-height:1.25;letter-spacing:-.02em;margin:0 0 .6rem}
h2{font-size:1.2rem;letter-spacing:-.01em;margin:2.5rem 0 .75rem;padding-top:.5rem;scroll-margin-top:1.5rem}
.lead{color:var(--muted);margin:0 0 1.5rem}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem;margin:0 0 2rem}
.path,code{font:.85rem var(--mono)}
.path{color:var(--muted)}
code{background:var(--code-bg);padding:.12rem .4rem;border-radius:6px}
.badge{display:inline-block;font-size:.75rem;font-weight:600;padding:.12rem .6rem;border-radius:999px;background:var(--accent-bg);color:var(--accent)}
.badge.warn{background:var(--warn-bg);color:var(--warn)}
ul.items{margin:0;padding-left:1.2rem}ul.items li{margin:.35rem 0}
ul.items li::marker{color:var(--muted)}
.files{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.files li{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem;padding:.7rem 1rem}
.files li+li{border-top:1px solid var(--line)}
.files .desc{flex:1 1 12rem}
.callout{border-radius:12px;padding:.8rem 1rem;margin:.6rem 0;font-size:.92rem;border:1px solid transparent}
.callout.error{background:var(--error-bg);color:var(--error)}
.callout.warning{background:var(--warn-bg);color:var(--warn)}
.cards{display:grid;gap:.75rem}
.card{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.25rem;border:1px solid var(--line);border-radius:12px}
.card:hover{border-color:var(--accent)}
.card strong{display:block;font-size:1.02rem}
.card .desc{display:block;color:var(--muted);font-size:.9rem;margin:.1rem 0 .3rem}
.main h2+.cards{margin-top:.5rem}
.toc{position:sticky;top:3rem;align-self:start;font-size:.85rem}
.toc a{display:block;padding:.25rem 0 .25rem .9rem;color:var(--muted);border-left:1px solid var(--line)}
.toc a:hover{color:var(--text);border-left-color:var(--accent)}
.er-wrap{overflow-x:auto;margin:1rem 0;padding:1rem;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.er{display:block;max-width:100%;min-width:620px;height:auto}
.er-box{fill:var(--bg);stroke:var(--line);stroke-width:1.2}
.er-rule{stroke:var(--line)}
.er-title{font:600 14px var(--mono);fill:var(--text)}
.er-name{font:13px var(--mono);fill:var(--text)}
.er-type{font:12px var(--mono);fill:var(--muted)}
.er-mark{font:700 10px var(--mono);fill:var(--accent)}
.er-line{fill:none;stroke:var(--muted);stroke-width:1.4}
.er-arrow{fill:var(--muted)}
@media (max-width:1100px){.main{grid-template-columns:minmax(0,44rem)}.toc{display:none}}
@media (max-width:760px){
  .shell{display:block}
  .side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}
  .main{padding:1.5rem 1rem 4rem}
}
`;
