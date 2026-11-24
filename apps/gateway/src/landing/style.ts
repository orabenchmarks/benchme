/**
 * The front page's whole style, inline: the page loads nothing from anywhere. Colours are tokens, set again for a
 * dark scheme; the layout is one column at phone width and a grid of cards above it, with no horizontal scroll.
 */
export const LANDING_CSS = `:root{color-scheme:light dark;--bg:#f5f6f8;--fg:#15171c;--muted:#566070;--card:#fff;--line:#dde2ea;--chip:#edf0f5;--code:#f0f2f6;--accent:#2a55d6;--accent-soft:#e8eefc;--shadow:0 1px 2px rgba(16,24,40,.05),0 2px 6px rgba(16,24,40,.06)}
@media (prefers-color-scheme:dark){:root{--bg:#0e1014;--fg:#e7e9ee;--muted:#a0a8b6;--card:#161920;--line:#2b303b;--chip:#222631;--code:#1b1f27;--accent:#8aa9ff;--accent-soft:#1d2540;--shadow:none}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:var(--accent);text-underline-offset:.15em}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.wrap{max-width:74rem;margin:0 auto;padding:0 16px}
.skip{position:absolute;left:-9999px;top:0}.skip:focus{left:16px;top:8px;z-index:1;background:var(--card);padding:.45rem .8rem;border:1px solid var(--line)}
.top{background:linear-gradient(180deg,var(--card),var(--bg));border-bottom:1px solid var(--line);padding:2.25rem 0 1.75rem}
.brand{margin:0 0 .4rem;font-weight:700;letter-spacing:.04em;color:var(--accent)}
h1{margin:0 0 .7rem;font-size:clamp(1.55rem,3.6vw,2.35rem);line-height:1.2;max-width:42rem}
.lede{margin:0 0 1.1rem;max-width:48rem;color:var(--muted);font-size:1.05rem}
.nav{display:flex;flex-wrap:wrap;gap:.4rem 1.3rem;margin:0;padding:0;list-style:none}
h2{margin:2.2rem 0 .8rem;font-size:1.3rem}
.search label{display:block;margin-bottom:.35rem;font-weight:600}
.search input{width:100%;max-width:38rem;padding:.7rem .9rem;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:10px}
.search input:focus-visible{outline-offset:0}
.hint{margin:.35rem 0 0;color:var(--muted);font-size:.9rem}
.count{margin:.9rem 0 1rem;color:var(--muted);font-size:.95rem}
.empty{margin:0 0 1rem;padding:1rem;color:var(--muted);border:1px dashed var(--line);border-radius:12px}
.cards{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,22.5rem),1fr))}
.card{display:flex;flex-direction:column;gap:.8rem;min-width:0;padding:1.1rem 1.15rem 1.05rem;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
.card-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.2rem .8rem}
.card h3{margin:0;font-size:1.15rem;line-height:1.3}
.key{color:var(--muted);font-size:.85rem}
.about{margin:0}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:.45rem .8rem;margin:0}
.facts dt{padding-top:.1rem;color:var(--muted);font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.facts dd{margin:0;min-width:0}
.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:0;padding:0;list-style:none}
.chips li{padding:.08rem .6rem;font-size:.85rem;background:var(--chip);border-radius:999px}
.chips code{font-size:.78rem;color:var(--muted)}
.doors li{background:var(--accent-soft)}
.missing{margin:.35rem 0 0;color:var(--muted);font-size:.85rem}
.links{display:flex;flex-wrap:wrap;gap:.3rem .9rem;margin:0;padding:0;list-style:none;font-size:.92rem}
.mint{margin-top:auto}
.mint-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.35rem;color:var(--muted);font-size:.8rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.mint pre,.example{margin:0;padding:.65rem .8rem;font-size:.8rem;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--code);border-radius:8px}
.copy{padding:.25rem .7rem;font:inherit;font-size:.8rem;letter-spacing:0;text-transform:none;color:var(--accent);background:transparent;border:1px solid var(--line);border-radius:8px;cursor:pointer}
.copy:hover{background:var(--accent-soft)}
.unavailable{margin:auto 0 0;padding:.6rem .8rem;color:var(--muted);font-size:.9rem;background:var(--code);border-radius:8px}
.apps{display:grid;gap:.35rem 1.5rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr));margin:0;padding:0;list-style:none}
.apps code{color:var(--muted);font-size:.85rem}
.muted{color:var(--muted)}
.sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
footer{margin:3rem auto 2rem;color:var(--muted);font-size:.9rem}`;
