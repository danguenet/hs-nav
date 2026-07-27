export const overlayStyles = `
  :host { all: initial; color-scheme: light; }
  * { box-sizing: border-box; }
  .backdrop { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: start center; padding: min(7vh, 52px) 16px 24px; background: rgb(13 38 61 / .22); backdrop-filter: blur(5px); font: 14px/1.45 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .dialog { width: min(560px, calc(100vw - 32px)); max-height: min(88vh, 600px); overflow: hidden; color: #17324d; background: #fff; border: 1px solid #c4d0da; border-radius: 12px; box-shadow: 0 20px 55px rgb(24 50 77 / .22); }
  .search-row { padding: 12px; border-bottom: 1px solid #dce4ea; }
  input { width: 100%; min-width: 0; height: 46px; padding: 10px 13px; color: #17324d; background: #fff; border: 1px solid #9fb1bf; border-radius: 7px; font: 500 16px/1.3 inherit; }
  input::placeholder { color: #74879a; }
  input:focus, button:focus-visible, .option:focus-visible { outline: 3px solid rgb(42 165 179 / .32); outline-offset: 2px; border-color: #0f7f86; }
  .results { max-height: min(68vh, 460px); overflow: auto; padding: 6px 8px; }
  .group-label { padding: 8px 10px 4px; color: #5f7487; font-size: 11px; font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }
  .group-label:not(:first-child) { margin-top: 3px; padding-top: 10px; border-top: 1px solid #e3e9ee; }
  .option { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; min-height: 44px; padding: 5px 10px 5px 6px; border-radius: 7px; }
  .option:not([data-active="true"]):not([data-group-end="true"]) { border-bottom: 1px solid #edf1f4; border-radius: 0; }
  .option[data-active="true"] { background: #eaf4f7; }
  .option-open { min-width: 0; min-height: 34px; padding: 4px 8px; overflow: hidden; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 6px; font: inherit; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .favorite { min-width: 40px; min-height: 34px; padding: 4px 7px 6px; color: #607d98; background: transparent; border: 1px solid transparent; border-radius: 6px; font: 400 22px/1 inherit; cursor: pointer; }
  .favorite[data-active="true"] { color: #a64b08; }
  .favorite:hover { background: #f0f7f8; }
  button:disabled { cursor: wait; opacity: .58; }
  .empty { padding: 34px 14px; color: #50677c; text-align: center; }
  .footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 8px 12px 8px 14px; color: #667b8d; background: #f8fafc; border-top: 1px solid #e1e8ed; font-size: 12px; }
  .hints { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .hint { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .keys { display: inline-flex; gap: 3px; }
  kbd { min-width: 22px; height: 22px; padding: 0 5px; color: #41596c; background: #fff; border: 1px solid #cdd8e0; border-bottom-color: #b9c7d1; border-radius: 5px; box-shadow: 0 1px 0 #b9c7d1; font-family: inherit; font-size: 11px; font-weight: 650; line-height: 20px; text-align: center; }
  .settings { min-height: 34px; padding: 6px 9px; color: #0f7f86; background: transparent; border: 1px solid transparent; border-radius: 6px; font: 700 12px/1 inherit; cursor: pointer; }
  .settings:hover { background: #f0f7f8; }
  .status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .notice { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(430px, calc(100vw - 32px)); padding: 14px; color: #213343; background: #fff; border: 1px solid #f5c26b; border-left: 5px solid #f5a623; border-radius: 9px; box-shadow: 0 8px 30px rgb(33 51 67 / .24); font: 14px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; }
  .notice-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .notice button, .notice a { padding: 6px 10px; color: #33475b; background: #fff; border: 1px solid #99acc2; border-radius: 6px; font: inherit; text-decoration: none; cursor: pointer; }
  @media (max-width: 520px) { .backdrop { padding-inline: 10px; } .dialog { width: calc(100vw - 20px); } .hints { gap: 8px; } .hint-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; } }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
  @media (forced-colors: active) { .dialog, .notice { border: 2px solid CanvasText; } .option[data-active="true"] { outline: 2px solid Highlight; } }
`;
