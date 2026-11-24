/**
 * The style of the front page and the scenario pages, inline: nothing is fetched from another host (a per-run stack
 * may have no network). One set of colour tokens, light and dark; the terminal card stays dark in both, like a
 * terminal. System fonts only, given a real scale: a heavy, tight display size, a calm body size, a mono for what a
 * person copies or reads as an identifier.
 */
export const LANDING_CSS = `
:root{
--bg:#f3f5f9;--bg-2:#e9edf4;--surface:#fff;--ink:#0f1522;--ink-2:#465063;--ink-3:#6b7588;--line:#dbe1ea;
--accent:#2457d6;--accent-2:#1d47b3;--accent-soft:#e7eeff;--focus:#2457d6;
--term:#0e1420;--term-2:#151d2d;--term-edge:transparent;--term-ink:#e7ecf6;--term-dim:#8792a8;--term-key:#86c5ff;--term-str:#a6e3a1;--term-num:#f5c27a;
--a0:#2a78d6;--a1:#eb6834;--a2:#1baf7a;--a3:#d9950a;--a4:#d9578b;--a5:#6250d6;
--easy:#1a8f5c;--medium:#2a78d6;--hard:#c4600f;--very-hard:#b2321f;--impossible:#5b5f6b;
--font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
--radius:14px;--shadow:0 1px 2px rgb(15 21 34/.06),0 8px 24px rgb(15 21 34/.06)}
@media (prefers-color-scheme:dark){:root{
--bg:#0a0e16;--bg-2:#0f1521;--surface:#121a27;--ink:#e8edf6;--ink-2:#a9b3c6;--ink-3:#7f8a9e;--line:#222c3c;
--accent:#79a8ff;--accent-2:#9dbdff;--accent-soft:#17243c;--focus:#9dbdff;
--term:#070b12;--term-2:#0d1320;--term-edge:#223049;
--a0:#3987e5;--a1:#d95926;--a2:#199e70;--a3:#c98500;--a4:#d55181;--a5:#9085e9;
--easy:#3fbf86;--medium:#5b9cf0;--hard:#e58a3c;--very-hard:#ef6b55;--impossible:#9aa0ad;
--shadow:0 1px 2px rgb(0 0 0/.3),0 8px 24px rgb(0 0 0/.25);color-scheme:dark}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--font)}
a{color:var(--accent)}a:hover{color:var(--accent-2)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:6px}
code,kbd,pre{font-family:var(--mono)}
kbd{font:600 12px/1 var(--mono);border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;padding:2px 5px;background:var(--surface);color:var(--ink)}
.lede code,.next code,.section-lede code,.steps3 code,.empty code,.hint code{font-size:.88em;background:var(--bg-2);color:var(--ink);border-radius:5px;padding:.1em .35em;overflow-wrap:anywhere}
.wrap{max-width:1180px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left,0px));padding-right:max(20px,env(safe-area-inset-right,0px))}
.skip{position:absolute;left:-999px;top:8px}.skip:focus{left:12px;z-index:5;background:var(--surface);padding:6px 10px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
/* the bar */
.bar{border-bottom:1px solid var(--line);background:var(--surface)}
.bar .wrap{display:flex;align-items:center;gap:20px;min-height:60px;flex-wrap:wrap}
.brand{font:800 19px/1 var(--font);letter-spacing:-.02em;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;gap:9px}
.brand-mark{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,var(--a0),var(--a2));display:inline-block}
.bar nav{margin-left:auto}.bar ul{display:flex;gap:18px;list-style:none;margin:0;padding:0;flex-wrap:wrap}
.bar nav a{color:var(--ink-2);text-decoration:none;font-size:15px}.bar nav a:hover{color:var(--ink)}
@media (max-width:560px){.bar .opt{display:none}.bar ul{gap:14px}}
/* the first screen */
.hero{padding-block:52px 36px}
.hero-head{max-width:940px}
.hero h1{font-size:clamp(34px,4.4vw,58px);line-height:1.04}
.hero-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:40px;align-items:center}
@media (max-width:960px){.hero-grid{grid-template-columns:minmax(0,1fr)}}
.eyebrow{font:600 12px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 16px}
.eyebrow code{text-transform:none;letter-spacing:0;font-size:13px}
h1{font:800 clamp(32px,3.9vw,48px)/1.06 var(--font);letter-spacing:-.03em;margin:0;text-wrap:balance}
.lede{font-size:18px;color:var(--ink-2);margin:16px 0 24px;max-width:36em}
.visual-wrap{margin:0;background:radial-gradient(120% 90% at 70% 40%,var(--accent-soft),transparent 70%);border-radius:24px;padding:8px}
.visual{display:block;width:100%;height:auto}
/* the terminal card */
.term{background:var(--term);color:var(--term-ink);border:1px solid var(--term-edge);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
.term-head{display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;background:var(--term-2);font:600 13px/1 var(--font);color:var(--term-dim)}
.term-head .step{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#26324a;color:var(--term-ink);font:700 12px/1 var(--mono)}
.term-head .title{color:var(--term-ink)}
.term pre{margin:0;padding:14px 16px 16px;overflow-x:auto;font-size:13.5px;line-height:1.6;white-space:pre}
@media (max-width:560px){.term pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}}
.term .k{color:var(--term-key)}.term .s{color:var(--term-str)}.term .n{color:var(--term-num)}.term .d{color:var(--term-dim)}
.copy{margin-left:auto;font:600 13px/1 var(--font);color:#0e1420;background:#e7ecf6;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}
.copy:hover{background:#fff}.copy.light{color:var(--accent);background:var(--accent-soft)}
.term+.term{margin-top:12px}
.next{margin:16px 0 0;color:var(--ink-2);font-size:15px}
.next b{color:var(--ink)}
/* sections */
section.block{padding-block:40px}
h2{font:800 30px/1.15 var(--font);letter-spacing:-.02em;margin:0 0 10px;text-wrap:balance}
.section-lede{color:var(--ink-2);margin:0 0 26px;max-width:46em}
.steps3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;list-style:none;margin:0;padding:0}
@media (max-width:820px){.steps3{grid-template-columns:minmax(0,1fr)}}
.steps3 li{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.steps3 .num{font:800 13px/1 var(--mono);color:var(--accent)}
.steps3 h3{font:700 18px/1.3 var(--font);margin:8px 0 6px}.steps3 p{margin:0;color:var(--ink-2);font-size:15px}
/* search */
.search{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:end;margin:6px 0 10px}
.field{display:flex;flex-direction:column;gap:6px;min-width:0}
.field label{font:600 13px/1 var(--font);color:var(--ink-2)}
.field input,.field select{font:15px/1.2 var(--font);color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:0 12px;height:44px;min-width:0}
.field.grow{flex:1 1 280px}.field input{width:100%}
@media (max-width:560px){.search .field:not(.grow){flex:1 1 calc(50% - 7px)}.search .field select{width:100%}}
.hint{color:var(--ink-3);font-size:13px;margin:0}
.count{color:var(--ink-3);font-size:14px;margin:8px 0 18px}
.empty{background:var(--surface);border:1px dashed var(--line);border-radius:var(--radius);padding:18px;color:var(--ink-2)}
/* scenario cards */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:18px}
@media (max-width:400px){.cards{grid-template-columns:minmax(0,1fr)}}
.card{display:flex;flex-direction:column;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);min-width:0}
.card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.card h3{font:750 19px/1.25 var(--font);letter-spacing:-.01em;margin:0}
.card h3 a{color:inherit;text-decoration:none}.card h3 a:hover{color:var(--accent);text-decoration:underline}
.card .mint-code{display:block;width:100%;margin-top:10px;font-size:12.5px;white-space:pre;overflow-x:auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.key{font-size:12.5px;color:var(--ink-3);white-space:nowrap}
.card .about{margin:0;color:var(--ink-2);font-size:15px}
.tiles{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0}
.tiles li{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-2);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:3px 10px 3px 4px}
.tiles li .key{font-size:11.5px}
.tiles li i{width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;font:700 10px/1 var(--font);color:#fff;font-style:normal}
.doors{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0}
.doors li{font:600 12px/1 var(--mono);color:var(--ink-2);border:1px solid var(--line);border-radius:6px;padding:5px 7px}
.card-foot{margin-top:auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:6px;border-top:1px solid var(--line)}
.tasks-link{display:inline-flex;align-items:baseline;gap:6px;font-weight:650;text-decoration:none;padding-top:10px}
.tasks-link b{font:800 22px/1 var(--font);letter-spacing:-.02em}
.card-foot .copy{margin-left:auto;margin-top:10px}
.missing,.unavailable{font-size:13px;color:var(--ink-3);margin:0}
.a0{background:var(--a0)}.a1{background:var(--a1)}.a2{background:var(--a2)}.a3{background:var(--a3)}.a4{background:var(--a4)}.a5{background:var(--a5)}
/* the scenario page */
.crumbs{margin:0 0 18px;font-size:14px}.crumbs a{text-decoration:none}
.page-head{padding-block:40px 18px}
.page-head .wrap{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:36px;align-items:start}
@media (max-width:960px){.page-head .wrap{grid-template-columns:minmax(0,1fr)}}
.page-head h1{font-size:clamp(30px,4vw,44px)}
.page-head .lede{font-size:17px;margin-bottom:18px}
.page-head .tiles,.page-head .doors{margin-top:10px}
.page-head .missing{margin-top:8px}
.sources{margin:14px 0 0;font-size:14px;color:var(--ink-3)}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 0;padding:0;list-style:none}
.stats li{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:13px;color:var(--ink-3)}
.stats b{display:block;font:800 22px/1.1 var(--font);color:var(--ink);font-variant-numeric:tabular-nums}
.tasks{display:grid;gap:14px}
.task{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;min-width:0;overflow-wrap:anywhere;scroll-margin-top:16px}
.task:target{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.task-meta{display:grid;gap:10px;align-content:start}
@media (min-width:900px){.task{grid-template-columns:minmax(0,1fr) 260px;grid-template-areas:"convo meta" "foot meta";column-gap:24px}.task-meta{grid-area:meta;border-left:1px solid var(--line);padding-left:20px}.task .convo{grid-area:convo}.task-foot{grid-area:foot}}
.task-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.task-id{font-size:13px;color:var(--ink-3);margin-right:4px}
.chip{font:650 12px/1 var(--font);border-radius:999px;padding:5px 9px;background:var(--bg);color:var(--ink-2);border:1px solid var(--line)}
.lvl{color:#fff;border:0}
.lvl-easy{background:var(--easy)}.lvl-medium{background:var(--medium)}.lvl-hard{background:var(--hard)}.lvl-very-hard{background:var(--very-hard)}.lvl-impossible{background:var(--impossible)}
.convo{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.convo li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px}.convo li.one{grid-template-columns:minmax(0,1fr)}
.convo .n{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font:700 12px/1 var(--mono);background:var(--accent-soft);color:var(--accent)}
.convo p{margin:0}
.convo .said{font-size:15.5px;max-width:75ch}
.convo .how{font-size:13px;color:var(--ink-3);margin-top:4px}
.convo li+li .n{position:relative}
details.rubric{border-top:1px solid var(--line);padding-top:10px}
details.rubric summary{cursor:pointer;font:600 13px/1.4 var(--font);color:var(--accent);width:fit-content}
details.rubric ul{margin:8px 0 0;padding-left:20px;color:var(--ink-2);font-size:14px}
footer.foot{border-top:1px solid var(--line);margin-top:40px;padding-block:28px 44px;color:var(--ink-3);font-size:14px}
footer.foot .wrap{display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}
/* the picture */
.v-ws{fill:var(--surface);stroke:var(--line);stroke-width:1.5}
.v-ws-back{fill:var(--bg-2);opacity:.9}
.v-ws-label{font:700 13px var(--mono);fill:var(--ink)}
.v-pill rect{fill:var(--accent)}.v-pill text{font:700 12px var(--font);fill:var(--surface)}
.v-ws-back-label{font:500 11.5px var(--mono);fill:var(--ink-3)}
.v-win{fill:var(--bg);stroke:var(--line)}
.v-dot{fill:var(--line)}
.v-path{font:500 10px var(--mono);fill:var(--ink-3)}
.v-app-head{opacity:.92}.v-app-name{font:700 10.5px var(--font);fill:#fff}
.v-line{fill:var(--line)}
.v-btn{opacity:.85}
.v-app-0{fill:var(--a0)}.v-app-1{fill:var(--a1)}.v-app-2{fill:var(--a2)}.v-app-3{fill:var(--a3)}.v-app-4{fill:var(--a4)}.v-app-5{fill:var(--a5)}
.v-more{font:600 13px var(--font);fill:var(--ink-3)}
.v-node rect{fill:var(--surface);stroke:var(--ink);stroke-width:1.5}
.v-node text{font:650 14px var(--font);fill:var(--ink)}
.v-node .v-node-glyph{font:800 18px var(--mono);fill:var(--accent)}
.v-gate rect{fill:var(--accent-soft);stroke:var(--accent)}
.v-node .v-node-sub{font:500 10.5px var(--mono);fill:var(--ink-3)}
.v-node-faint{opacity:.55}.v-node-faint rect{stroke-dasharray:4 4}
.v-link{fill:none;stroke:var(--ink-3);stroke-width:1.8}
.v-link-faint{stroke-dasharray:4 5;opacity:.6}
.v-arrow-head{fill:var(--ink-3)}
.v-flow{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round;stroke-dasharray:12 152;opacity:0}
.v-doors-label{font:600 12px var(--font);fill:var(--ink-3)}
.v-door rect{fill:var(--surface);stroke:var(--line)}
.v-door text{font:700 12px var(--mono);fill:var(--ink-2)}
@media (prefers-reduced-motion:no-preference){.v-flow{opacity:1;animation:v-flow 2.6s linear infinite}@keyframes v-flow{to{stroke-dashoffset:-164}}}
`;
