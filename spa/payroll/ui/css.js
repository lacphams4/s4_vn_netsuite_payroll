/**
 * CSS chung của giao diện bản 2 (tiền tố lớp s4vp-), chèn một lần vào document.head bằng ensureCss().
 * Màu, bo góc, khoảng cách theo mẫu docs/design/*.dc.html; phông chữ kế thừa trang NetSuite.
 * Vùng bấm cao tối thiểu 32 px (nút thường 36 px); số tiền căn phải, tabular-nums.
 * Lề trang: --s4vp-pad-l / --s4vp-pad-r. Lề phải rộng hơn lề trái vì NetSuite có cột nút trợ giúp nổi (rộng khoảng 40 px)
 * dính mép phải, đứng yên khi cuộn: mọi thứ nằm trong dải đó đều có lúc bị che, nên cả trang tránh dải này.
 * Bố cục hai cột: s4vp-cols > s4vp-col-main (6 phần) + s4vp-col-side hoặc SidePanel (4 phần); hẹp hơn 812 px thì xếp dọc.
 */
const CSS = `
.s4vp-app{--s4vp-bg:#F3F4F2;--s4vp-surface:#FFFFFF;--s4vp-text:#1D2730;--s4vp-sub:#55616B;--s4vp-accent:#24566B;--s4vp-accent-dark:#16394A;--s4vp-accent-soft:#E6EFF3;--s4vp-line:#E1E5E8;--s4vp-line-soft:#E8EBEE;--s4vp-ctl:#B8C1C8;
--s4vp-ok:#0F5132;--s4vp-ok-bg:#DDF1E4;--s4vp-warn:#6B3A00;--s4vp-warn-bg:#FFE9C7;--s4vp-warn-line:#C97A12;--s4vp-err:#8A1C14;--s4vp-err-bg:#FBE3E0;--s4vp-info:#16394A;--s4vp-info-bg:#E6EFF3;--s4vp-pad-l:12px;--s4vp-pad-r:52px;--s4vp-gap:12px;
font-family:inherit;font-size:14px;line-height:1.4;color:var(--s4vp-text);background:var(--s4vp-bg);min-height:80vh;height:max-content;width:100%;flex:0 0 auto;box-sizing:border-box;text-align:left}
.s4vp-app *,.s4vp-app *::before,.s4vp-app *::after{box-sizing:border-box}
:where(.s4vp-app) button,:where(.s4vp-app) input,:where(.s4vp-app) select,:where(.s4vp-app) textarea{font:inherit;color:inherit;margin:0}
.s4vp-app button{cursor:pointer}
.s4vp-app button[disabled]{cursor:not-allowed;opacity:.55}
.s4vp-app button:focus-visible,.s4vp-app input:focus-visible,.s4vp-app select:focus-visible,.s4vp-app textarea:focus-visible{outline:2px solid var(--s4vp-accent);outline-offset:1px}
.s4vp-app h1,.s4vp-app h2,.s4vp-app h3{margin:0;font-family:inherit;color:inherit}

.s4vp-nav{background:var(--s4vp-surface);border-bottom:1px solid #D9DEE2;padding:0 var(--s4vp-pad-r) 0 var(--s4vp-pad-l);display:flex;flex-wrap:wrap;gap:2px 6px;align-items:center}
.s4vp-brand{font-size:16px;font-weight:700;padding:0 14px 0 0;white-space:nowrap}
.s4vp-navtab{background:none;border:0;border-bottom:3px solid transparent;color:#3A4650;padding:10px 12px 7px;font-size:14px;min-height:40px;white-space:nowrap}
.s4vp-navtab:hover{color:var(--s4vp-accent-dark)}
.s4vp-navtab.s4vp-on{color:var(--s4vp-accent-dark);border-bottom-color:var(--s4vp-accent);font-weight:700}
.s4vp-navright{margin-left:auto;display:flex;align-items:center;gap:8px;padding:3px 0}
.s4vp-navright .s4vp-in{min-height:32px}
.s4vp-navright .s4vp-lbl{font-size:12px;color:var(--s4vp-sub);white-space:nowrap}
.s4vp-busy{display:inline-flex;gap:8px;align-items:center;font-size:13px;color:var(--s4vp-sub);max-width:320px;overflow:hidden;white-space:nowrap}
.s4vp-strip{margin:8px var(--s4vp-pad-r) 0 var(--s4vp-pad-l);padding:4px 12px;border-radius:8px;display:flex;gap:12px;align-items:flex-start;justify-content:space-between;font-size:14px;border:1px solid transparent}
.s4vp-strip-ok{color:var(--s4vp-ok);background:var(--s4vp-ok-bg);border-color:#B7DFC5}
.s4vp-strip-warn{color:var(--s4vp-warn);background:var(--s4vp-warn-bg);border-color:#F0D3A6}
.s4vp-strip-error{color:var(--s4vp-err);background:var(--s4vp-err-bg);border-color:#F1BDB7}
.s4vp-strip-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap;align-self:center}
.s4vp-x{background:none;border:0;min-width:32px;min-height:32px;border-radius:8px;font-size:18px;line-height:1;color:inherit;flex:0 0 auto}
.s4vp-x:hover{background:rgba(0,0,0,.07)}
.s4vp-spin{width:16px;height:16px;border-radius:50%;border:2px solid var(--s4vp-ctl);border-top-color:var(--s4vp-accent);animation:s4vp-rot .8s linear infinite;flex:0 0 auto;align-self:center}
@keyframes s4vp-rot{to{transform:rotate(360deg)}}

.s4vp-page{padding:12px var(--s4vp-pad-r) 24px var(--s4vp-pad-l);display:flex;flex-direction:column;gap:var(--s4vp-gap);min-width:0}
.s4vp-ph{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;justify-content:space-between}
.s4vp-ph-main{display:flex;gap:8px;align-items:flex-start;flex:1 1 320px;min-width:0}
.s4vp-ph-text{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-width:0}
.s4vp-back{flex:0 0 auto;width:32px;height:32px;padding:0 0 2px;border-radius:8px;border:1px solid var(--s4vp-ctl);background:var(--s4vp-surface);color:var(--s4vp-accent);font-size:20px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.s4vp-back:hover{background:var(--s4vp-accent-soft)}
.s4vp-ph-title{display:flex;gap:10px;align-items:center;min-width:0;min-height:32px}
.s4vp-ph-title h1{font-size:21px;font-weight:700;line-height:1.25;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s4vp-ph-title .s4vp-badge{flex:0 0 auto}
.s4vp-ph-sub{font-size:12px;color:var(--s4vp-sub);min-width:0;overflow-wrap:anywhere}
.s4vp-ph-sub .s4vp-btn-link{min-height:32px;font-size:12px}
.s4vp-ph > .s4vp-actions{flex:0 1 auto;justify-content:flex-end;margin-left:auto}
.s4vp-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}

.s4vp-btn{font-size:14px;min-height:36px;padding:0 16px;border-radius:8px;border:1px solid var(--s4vp-ctl);background:var(--s4vp-surface);color:var(--s4vp-text);display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.s4vp-btn:hover{background:#F7F8F9}
.s4vp-btn-primary{font-weight:600;padding:0 20px;border-color:var(--s4vp-accent);background:var(--s4vp-accent);color:#FFFFFF}
.s4vp-btn-primary:hover{background:var(--s4vp-accent-dark)}
.s4vp-btn-danger{font-weight:600;border-color:var(--s4vp-err);background:var(--s4vp-surface);color:var(--s4vp-err)}
.s4vp-btn-danger:hover{background:var(--s4vp-err-bg)}
.s4vp-btn-ghost{border-color:transparent;background:none;color:var(--s4vp-accent)}
.s4vp-btn-ghost:hover{background:var(--s4vp-accent-soft)}
.s4vp-btn-dashed{border:1px dashed #8FA0AB;color:var(--s4vp-accent);font-weight:600}
.s4vp-btn-link{border:0;background:none;color:var(--s4vp-accent);font-weight:600;padding:0 2px;min-height:36px;text-decoration:none}
.s4vp-btn-link:hover{background:none;color:var(--s4vp-accent-dark);text-decoration:underline}
.s4vp-btn-sm{min-height:36px;padding:0 10px;font-size:13px}
.s4vp-btn-block{width:100%}

.s4vp-menu{position:relative;display:inline-block}
.s4vp-menu-list{position:absolute;top:100%;left:0;margin-top:4px;min-width:200px;max-width:340px;background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:10px;box-shadow:0 8px 24px rgba(29,39,48,.16);padding:6px;display:flex;flex-direction:column;z-index:900}
.s4vp-menu-right .s4vp-menu-list{left:auto;right:0}
.s4vp-menu-item{background:none;border:0;border-radius:6px;text-align:left;min-height:36px;padding:6px 10px;font-size:14px;color:var(--s4vp-text)}
.s4vp-menu-item:hover{background:var(--s4vp-accent-soft)}

.s4vp-steps{list-style:none;margin:0;padding:4px 14px;background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;display:flex;flex-wrap:wrap;gap:0 24px;font-size:14px}
.s4vp-step{display:flex;gap:8px;align-items:center;color:var(--s4vp-sub);margin:0;padding:0;min-height:32px}
.s4vp-step-n{width:24px;height:24px;border-radius:50%;border:1px solid var(--s4vp-ctl);display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex:0 0 auto}
.s4vp-step-note{font-size:12px;color:var(--s4vp-sub);font-weight:400}
.s4vp-step-done{color:var(--s4vp-ok)}
.s4vp-step-done .s4vp-step-n{background:var(--s4vp-ok-bg);border-color:var(--s4vp-ok-bg);font-weight:700}
.s4vp-step-current{color:var(--s4vp-text);font-weight:700}
.s4vp-step-current .s4vp-step-n{background:var(--s4vp-accent);border-color:var(--s4vp-accent);color:#FFFFFF;font-weight:700}
.s4vp-step-note.s4vp-t-warn{color:#8A4B00;font-weight:600}
.s4vp-step-note.s4vp-t-error{color:var(--s4vp-err);font-weight:600}
.s4vp-step-note.s4vp-t-ok{color:var(--s4vp-ok)}
.s4vp-step-btn{background:none;border:0;padding:0;min-height:32px;display:flex;gap:8px;align-items:center;color:inherit;font-weight:inherit}

.s4vp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--s4vp-gap)}
.s4vp-stat{background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;padding:8px 14px;display:flex;flex-direction:column;gap:1px;min-width:0}
.s4vp-stat-l{font-size:12px;color:var(--s4vp-sub)}
.s4vp-stat-v{font-size:20px;line-height:1.25;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.s4vp-stat-n{font-size:12px;color:var(--s4vp-sub)}
.s4vp-stat.s4vp-t-warn{border-color:#F0D3A6}
.s4vp-stat.s4vp-t-warn .s4vp-stat-v{color:var(--s4vp-warn)}
.s4vp-stat.s4vp-t-error{border-color:#F1BDB7}
.s4vp-stat.s4vp-t-error .s4vp-stat-v{color:var(--s4vp-err)}
.s4vp-stat.s4vp-t-ok .s4vp-stat-v{color:var(--s4vp-ok)}

.s4vp-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.s4vp-chip{font-size:13px;min-height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--s4vp-ctl);background:var(--s4vp-surface);color:var(--s4vp-text);white-space:nowrap}
.s4vp-chip:hover{background:#F7F8F9}
.s4vp-chip.s4vp-on{font-weight:600;border-color:var(--s4vp-accent);background:var(--s4vp-accent-soft);color:var(--s4vp-accent-dark)}
.s4vp-chip.s4vp-on.s4vp-t-warn{border-color:var(--s4vp-warn-line);background:var(--s4vp-warn-bg);color:var(--s4vp-warn)}
.s4vp-chip.s4vp-on.s4vp-t-error{border-color:var(--s4vp-err);background:var(--s4vp-err-bg);color:var(--s4vp-err)}

.s4vp-tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--s4vp-line)}
.s4vp-tab{font-size:13px;min-height:36px;padding:0 10px;border:0;border-bottom:3px solid transparent;background:none;color:var(--s4vp-sub);white-space:nowrap}
.s4vp-tab:hover{color:var(--s4vp-accent-dark)}
.s4vp-tab.s4vp-on{font-weight:600;border-bottom-color:var(--s4vp-accent);color:var(--s4vp-accent-dark)}

.s4vp-badge{display:inline-block;font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px;white-space:nowrap;color:var(--s4vp-sub);background:#EEF0F2}
.s4vp-badge-lg{font-size:13px;padding:4px 10px}
.s4vp-badge.s4vp-t-ok{color:var(--s4vp-ok);background:var(--s4vp-ok-bg)}
.s4vp-badge.s4vp-t-warn{color:var(--s4vp-warn);background:var(--s4vp-warn-bg)}
.s4vp-badge.s4vp-t-error{color:var(--s4vp-err);background:var(--s4vp-err-bg)}
.s4vp-badge.s4vp-t-info{color:var(--s4vp-info);background:var(--s4vp-info-bg)}

.s4vp-card{background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;display:flex;flex-direction:column;min-width:0}
.s4vp-card.s4vp-t-warn{border-color:#F0D3A6}
.s4vp-card.s4vp-t-error{border-color:#F1BDB7}
.s4vp-card.s4vp-t-ok{border-color:#B7DFC5}
.s4vp-card-h{padding:10px 14px 8px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between}
.s4vp-card-t{font-size:16px;font-weight:700}
.s4vp-card-s{font-size:13px;color:var(--s4vp-sub);font-weight:400}
.s4vp-card-b{padding:12px 14px;display:flex;flex-direction:column;gap:12px;min-width:0}
.s4vp-card-h + .s4vp-card-b{padding-top:4px}
.s4vp-card-flush{padding:0;gap:0}
.s4vp-card-h + .s4vp-card-flush{padding-top:0}

.s4vp-tbl-bar{padding:8px 12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.s4vp-tbl-bar-l{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}
.s4vp-tbl-bar-r{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-left:auto}
.s4vp-tbl-count{font-size:12px;color:var(--s4vp-sub)}
.s4vp-tbl-wrap{overflow-x:auto;max-width:100%}
.s4vp-tbl{border-collapse:collapse;width:100%}
.s4vp-tbl th{font-size:12px;font-weight:600;color:var(--s4vp-sub);text-align:left;padding:7px 8px;border-bottom:1px solid #D9DEE2;white-space:nowrap;background:#F7F8F9}
.s4vp-tbl td{font-size:14px;padding:8px;border-bottom:1px solid var(--s4vp-line-soft);text-align:left;vertical-align:middle;font-variant-numeric:tabular-nums;color:var(--s4vp-text)}
.s4vp-tbl th:first-child,.s4vp-tbl td:first-child{padding-left:12px}
.s4vp-tbl th:last-child,.s4vp-tbl td:last-child{padding-right:12px}
.s4vp-tbl .s4vp-r{text-align:right}
.s4vp-tbl .s4vp-c{text-align:center}
.s4vp-tbl .s4vp-nw{white-space:nowrap}
.s4vp-tbl tbody tr:last-child td{border-bottom:0}
.s4vp-tbl-click tbody tr.s4vp-row{cursor:pointer}
.s4vp-tbl-click tbody tr.s4vp-row:hover{background:#F4F7F9}
.s4vp-tbl tbody tr.s4vp-sel,.s4vp-tbl-click tbody tr.s4vp-sel:hover{background:#EAF2F5}
.s4vp-tbl tbody tr.s4vp-sel td:first-child{box-shadow:inset 3px 0 0 var(--s4vp-accent)}
.s4vp-tbl tr.s4vp-total td{font-weight:700}
.s4vp-tbl-sticky th{position:sticky;top:0;z-index:1}
.s4vp-rowbtn{background:none;border:0;padding:0;text-align:inherit;color:inherit;font:inherit;min-height:0;display:block;width:100%}
.s4vp-link{color:var(--s4vp-accent);font-weight:600}
.s4vp-muted{color:var(--s4vp-sub)}
.s4vp-small{font-size:12px;color:var(--s4vp-sub)}
.s4vp-num{text-align:right;font-variant-numeric:tabular-nums}

.s4vp-field{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--s4vp-sub);min-width:0}
.s4vp-field-hint{font-size:12px;color:var(--s4vp-sub)}
.s4vp-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px 14px}
.s4vp-in{font-size:14px;min-height:36px;width:100%;max-width:100%;padding:0 12px;border:1px solid var(--s4vp-ctl);border-radius:8px;background:var(--s4vp-surface);color:var(--s4vp-text)}
.s4vp-in[disabled]{background:#F3F4F2;color:var(--s4vp-sub)}
textarea.s4vp-in{padding:8px 12px;min-height:72px;resize:vertical;line-height:1.4}
select.s4vp-in{padding-right:28px}
.s4vp-in.s4vp-r{text-align:right;font-variant-numeric:tabular-nums}

.s4vp-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(29,39,48,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px}
.s4vp-dialog{background:var(--s4vp-surface);color:var(--s4vp-text);border-radius:12px;box-shadow:0 16px 48px rgba(29,39,48,.3);width:520px;max-width:100%;max-height:calc(100vh - 32px);display:flex;flex-direction:column}
.s4vp-dialog-h{padding:14px 12px 10px 18px;display:flex;gap:12px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--s4vp-line)}
.s4vp-dialog-t{font-size:17px;font-weight:700}
.s4vp-dialog-b{padding:16px 18px;display:flex;flex-direction:column;gap:14px;overflow:auto;font-size:14px}
.s4vp-dialog-f{padding:12px 18px 16px;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;border-top:1px solid var(--s4vp-line)}

.s4vp-cols{display:flex;flex-wrap:wrap;gap:var(--s4vp-gap);align-items:flex-start}
.s4vp-col-main{flex:6 1 480px;min-width:0;display:flex;flex-direction:column;gap:var(--s4vp-gap)}
.s4vp-col-side{flex:4 1 320px;min-width:0;display:flex;flex-direction:column;gap:var(--s4vp-gap)}
.s4vp-side{flex:4 1 320px;min-width:0;background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:12px}
.s4vp-col-side > .s4vp-side{flex:0 0 auto}
.s4vp-side-h{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.s4vp-side-t{font-size:17px;font-weight:700}
.s4vp-side-s{font-size:13px;color:var(--s4vp-sub)}
.s4vp-empty{padding:28px 16px;text-align:center;color:var(--s4vp-sub);font-size:14px}
.s4vp-row{}
.s4vp-line{display:flex;justify-content:space-between;gap:12px;font-size:14px}

.s4vp-cols-half{flex-wrap:nowrap;align-items:stretch}
.s4vp-cols-half > .s4vp-col-half{flex:1 1 0;min-width:0;display:flex;flex-direction:column}
.s4vp-pane{height:clamp(290px,calc(100vh - 378px),1200px);background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;display:flex;flex-direction:column;min-width:0;overflow:hidden}
.s4vp-pane-h{flex:0 0 auto;padding:6px 10px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;justify-content:space-between;min-width:0}
.s4vp-pane-h .s4vp-chips{gap:6px}
.s4vp-pane-h .s4vp-chip{min-height:30px;padding:0 10px}
.s4vp-pane-h .s4vp-in{min-height:30px}
.s4vp-pane-t{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.s4vp-pane-s{font-size:12px;color:var(--s4vp-sub);font-weight:400}
.s4vp-pane-msg{flex:0 0 auto;padding:0 12px 4px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s4vp-pane-b{flex:1 1 auto;min-height:0;overflow:auto}
.s4vp-pane-pad{padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.s4vp-pane-f{flex:0 0 auto;padding:4px 12px;border-top:1px solid var(--s4vp-line);display:flex;gap:10px;align-items:center;justify-content:space-between;min-height:28px;font-size:12px;color:var(--s4vp-sub)}
.s4vp-pane-f > span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.s4vp-pane-f .s4vp-btn{min-height:28px;flex:0 0 auto}
.s4vp-pane-b .s4vp-tbl-wrap{overflow:visible;max-width:none}
.s4vp-pane-b .s4vp-tbl th{position:sticky;top:0;z-index:1;padding:6px}
.s4vp-pane-b .s4vp-tbl td{font-size:13px;padding:6px}
.s4vp-pane-b .s4vp-tbl th:first-child,.s4vp-pane-b .s4vp-tbl td:first-child{padding-left:12px}
.s4vp-pane-b .s4vp-tbl th:last-child,.s4vp-pane-b .s4vp-tbl td:last-child{padding-right:12px}
.s4vp-pane-b .s4vp-tbl tr.s4vp-total td{position:sticky;bottom:0;background:#F7F8F9;box-shadow:inset 0 1px 0 #D9DEE2}
.s4vp-pane-b .s4vp-tbl .s4vp-btn-link{min-height:24px;font-size:13px}
.s4vp-pane-b .s4vp-tbl .s4vp-badge{padding:2px 7px}
.s4vp-pane-b .s4vp-tbl-bar{padding:0 0 8px}
.s4vp-pane-b .s4vp-tbl-bar .s4vp-in{min-height:30px}
.s4vp-pane-b .s4vp-tbl-bar .s4vp-btn{min-height:30px}
.s4vp-pane-b .s4vp-tbl-bar .s4vp-chip{min-height:30px;padding:0 10px}
.s4vp-pane-b .s4vp-empty{padding:18px 12px}
.s4vp-ell{display:block;max-width:210px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s4vp-tabs2{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:0 1px;align-items:center;border-bottom:1px solid var(--s4vp-line);padding:0 8px}
.s4vp-tabs2-g{display:contents}
.s4vp-tabs2-batch .s4vp-tab{background:#EEF3F6}
.s4vp-tabs2-cap{margin-left:auto;font-size:11px;font-weight:600;color:var(--s4vp-sub);padding:0 6px 0 10px;white-space:nowrap;text-transform:uppercase;letter-spacing:.03em}
.s4vp-tabs2 .s4vp-tab{min-height:30px;padding:0 5px;font-size:13px;display:inline-flex;align-items:center;gap:4px}
.s4vp-tab-n{font-size:11px;font-weight:700;padding:1px 6px;border-radius:999px;background:#EEF0F2;color:var(--s4vp-sub)}
.s4vp-tab-n.s4vp-t-warn{background:var(--s4vp-warn-bg);color:var(--s4vp-warn)}
.s4vp-tab-n.s4vp-t-error{background:var(--s4vp-err-bg);color:var(--s4vp-err)}
@media (max-width:812px){.s4vp-cols-half{flex-wrap:wrap}.s4vp-cols-half > .s4vp-col-half{flex:1 1 100%}.s4vp-pane{height:auto;max-height:80vh}}

.s4vp-la{--s4vp-la-a:#136C99;--s4vp-la-b:#C2691F;--s4vp-la-up:#7D55B0;--s4vp-la-down:#1E8E78;--s4vp-la-ink:#1D2730;display:flex;flex-direction:column;gap:var(--s4vp-gap);min-width:0}
.s4vp-la-stale{opacity:.55}
.s4vp-la-ctl{display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--s4vp-sub);white-space:nowrap}
.s4vp-la-ctl .s4vp-in{font-size:14px;padding:0 8px}
.s4vp-la-ctl select.s4vp-in{padding-right:22px}
.s4vp-la-center{display:flex;justify-content:center;padding-bottom:16px}
.s4vp-la-note{padding:4px 12px;border-radius:8px;display:flex;gap:12px;align-items:center;justify-content:space-between;font-size:13px;min-height:36px;border:1px solid #F0D3A6;color:var(--s4vp-warn);background:var(--s4vp-warn-bg)}
.s4vp-la-note-info{color:var(--s4vp-info);background:var(--s4vp-info-bg);border-color:#C9DCE4}
.s4vp-la-note-error{color:var(--s4vp-err);background:var(--s4vp-err-bg);border-color:#F1BDB7}
.s4vp-la .s4vp-stats{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.s4vp-la .s4vp-stat{padding:6px 12px}
.s4vp-la .s4vp-stat-v{font-variant-numeric:normal;white-space:nowrap}
.s4vp-la-pair{align-items:stretch}
.s4vp-la-pair > div > .s4vp-card{flex:1 1 auto}
.s4vp-la-chart{display:flex;flex-direction:column;gap:6px;min-width:0}
.s4vp-la-legend{display:flex;flex-wrap:wrap;gap:2px 14px;align-items:center;font-size:12px;color:var(--s4vp-sub)}
.s4vp-la-key{display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
.s4vp-la-hint{margin-left:auto;white-space:nowrap}
.s4vp-la-sw{display:inline-block;width:10px;height:10px;border-radius:2px;flex:0 0 auto}
.s4vp-la-sw-line{display:inline-block;width:16px;height:2px;border-radius:1px;background:var(--s4vp-la-ink);flex:0 0 auto}
.s4vp-la-sw-mark{display:inline-block;width:3px;height:12px;border-radius:1px;background:var(--s4vp-la-ink);flex:0 0 auto}
.s4vp-la-trend{display:flex;gap:6px;min-width:0}
.s4vp-la-yax{flex:0 0 50px;position:relative;font-size:11px;color:var(--s4vp-sub);font-variant-numeric:tabular-nums}
.s4vp-la-yax > span{position:absolute;right:0;line-height:12px;white-space:nowrap}
.s4vp-la-plot{flex:1 1 auto;min-width:0;position:relative}
.s4vp-la-grid{position:absolute;left:0;right:0;height:1px;background:var(--s4vp-line-soft);pointer-events:none}
.s4vp-la-linelayer{position:absolute;left:0;right:0;top:16px;height:42px;background-repeat:no-repeat;background-size:100% 100%;pointer-events:none}
.s4vp-la-slots{position:relative;display:flex;align-items:stretch}
.s4vp-app .s4vp-la-slot{flex:1 1 0;min-width:0;padding:0;border:0;background:none;border-radius:6px;display:flex;flex-direction:column;align-items:stretch;color:inherit;cursor:pointer}
.s4vp-app .s4vp-la-slot:hover{background:rgba(36,86,107,.07)}
.s4vp-app .s4vp-la-slot.s4vp-on{background:rgba(36,86,107,.12);cursor:default}
.s4vp-la-rcell{display:block;position:relative;height:64px}
.s4vp-la-rin{display:block;position:absolute;left:0;right:0;top:16px;height:42px}
.s4vp-la-dot{position:absolute;left:50%;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:var(--s4vp-la-ink);box-shadow:0 0 0 2px var(--s4vp-surface)}
.s4vp-la-vlab{position:absolute;left:50%;transform:translateX(-50%);font-size:11px;line-height:12px;font-weight:600;white-space:nowrap;color:var(--s4vp-text);font-variant-numeric:tabular-nums}
.s4vp-la-bcell{display:block;position:relative;height:132px;margin-top:8px}
.s4vp-la-stack{position:absolute;left:50%;bottom:0;width:22px;margin-left:-11px;height:100%;display:flex;flex-direction:column-reverse;gap:2px}
.s4vp-la-seg{display:block;flex:0 0 auto;min-height:1px}
.s4vp-la-seg-a{background:var(--s4vp-la-a)}
.s4vp-la-seg-b{background:var(--s4vp-la-b)}
.s4vp-la-seg-top{border-radius:4px 4px 0 0}
.s4vp-la-seg-bot{border-radius:0 0 4px 4px}
.s4vp-la-stack-neg{position:absolute;left:50%;width:22px;margin-left:-11px;display:flex;flex-direction:column;gap:2px}
.s4vp-la-grid.s4vp-la-zero{background:#8A949C}
.s4vp-la-negnote{font-size:12px;color:var(--s4vp-sub)}
.s4vp-la-x{display:block;height:18px;line-height:17px;font-size:11px;color:var(--s4vp-sub);text-align:center;white-space:nowrap;border-top:1px solid #D9DEE2;font-variant-numeric:tabular-nums}
.s4vp-la-slot.s4vp-on .s4vp-la-x{color:var(--s4vp-text);font-weight:700}
.s4vp-la-wf{display:flex;flex-direction:column;gap:2px;min-width:0}
.s4vp-la-wf-row{display:flex;align-items:center;gap:8px;height:20px;font-size:12px}
.s4vp-la-wf-l{flex:0 0 156px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s4vp-la-wf-t{flex:1 1 auto;position:relative;height:20px;min-width:40px}
.s4vp-la-wf-bar{position:absolute;top:4px;height:12px;min-width:2px;border-radius:2px}
.s4vp-la-wf-up{background:var(--s4vp-la-up)}
.s4vp-la-wf-down{background:var(--s4vp-la-down)}
.s4vp-la-wf-mark{position:absolute;top:1px;height:18px;width:3px;margin-left:-1px;border-radius:1px;background:var(--s4vp-la-ink)}
.s4vp-la-wf-link{position:absolute;top:16px;height:10px;width:1px;background:var(--s4vp-ctl)}
.s4vp-la-wf-v{flex:0 0 78px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.s4vp-la-wf-total .s4vp-la-wf-l,.s4vp-la-wf-total .s4vp-la-wf-v{font-weight:700}
.s4vp-la .s4vp-tbl td,.s4vp-la-drill .s4vp-tbl td{font-size:13px;padding:6px 8px}
.s4vp-la .s4vp-tbl th,.s4vp-la-drill .s4vp-tbl th{padding:6px 8px}
.s4vp-la .s4vp-tbl th:first-child,.s4vp-la .s4vp-tbl td:first-child,.s4vp-la-drill .s4vp-tbl th:first-child,.s4vp-la-drill .s4vp-tbl td:first-child{padding-left:12px}
.s4vp-la .s4vp-tbl th:last-child,.s4vp-la .s4vp-tbl td:last-child,.s4vp-la-drill .s4vp-tbl th:last-child,.s4vp-la-drill .s4vp-tbl td:last-child{padding-right:12px}
.s4vp-la .s4vp-tbl-bar{padding:6px 12px}
.s4vp-la .s4vp-tbl-bar .s4vp-chip{min-height:32px;padding:0 12px}
.s4vp-la .s4vp-tbl-bar .s4vp-in{min-height:32px}
.s4vp-la .s4vp-tbl-sticky tr.s4vp-total td,.s4vp-la-drill .s4vp-tbl-sticky tr.s4vp-total td{position:sticky;bottom:0;background:#F7F8F9;box-shadow:inset 0 1px 0 #D9DEE2}
.s4vp-la-drill .s4vp-tbl-bar{padding:0 0 8px}
.s4vp-la-name{display:block;max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s4vp-la-acct{max-width:176px}
.s4vp-la-share{display:inline-flex;gap:8px;align-items:center;justify-content:flex-end}
.s4vp-la-share-t{display:block;flex:0 0 56px;width:56px;height:6px;border-radius:3px;background:var(--s4vp-accent-soft);overflow:hidden}
.s4vp-la-share-f{display:block;height:100%;border-radius:3px;background:var(--s4vp-accent)}
.s4vp-la-share-n{display:inline-block;min-width:44px;text-align:right}
.s4vp-la-indent{display:block;padding-left:18px;color:var(--s4vp-sub)}
.s4vp-la-strong{font-weight:700}
.s4vp-la-summary{padding:2px 14px 10px;font-size:13px;color:var(--s4vp-sub)}
.s4vp-adv-emp{display:flex;flex-direction:column;gap:1px;min-width:0}
.s4vp-adv-emp-n{font-weight:600;overflow-wrap:anywhere}
.s4vp-adv-who{display:flex;flex-wrap:wrap;gap:0 8px;align-items:baseline;min-width:0}
.s4vp-adv-memo{display:block;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s4vp-adv-side > .s4vp-side{max-height:max(316px,calc(100vh - 328px));overflow-y:auto}
.s4vp-adv-state{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.s4vp-adv-acts{justify-content:flex-start}
.s4vp-adv-reason{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--s4vp-warn-bg);color:var(--s4vp-warn)}
.s4vp-adv-reason.s4vp-adv-err{background:var(--s4vp-err-bg);color:var(--s4vp-err)}
.s4vp-adv-err{color:var(--s4vp-err);font-size:12px}
.s4vp-adv-info{display:flex;flex-direction:column;gap:6px;padding:10px 0;border-top:1px solid var(--s4vp-line-soft);border-bottom:1px solid var(--s4vp-line-soft)}
.s4vp-adv-info .s4vp-line{align-items:baseline}
.s4vp-adv-val{text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-width:0}
.s4vp-adv-sub{font-size:14px;font-weight:700}
.s4vp-adv-offsets{border:1px solid var(--s4vp-line);border-radius:10px;overflow:hidden}
.s4vp-adv-offsets .s4vp-tbl-bar{padding:6px 8px}
.s4vp-adv-top{display:grid;grid-template-columns:150px minmax(0,1.2fr) minmax(0,1fr) minmax(0,1.2fr);gap:10px 12px;align-items:start}
.s4vp-adv-find{display:flex;flex-direction:column;gap:6px}
.s4vp-adv-results{flex:0 0 auto;border:1px solid var(--s4vp-line);border-radius:8px;max-height:112px;overflow-y:auto;display:flex;flex-direction:column}
.s4vp-adv-result{display:flex;gap:12px;align-items:center;justify-content:space-between;min-height:36px;padding:4px 12px;border:0;border-bottom:1px solid var(--s4vp-line-soft);background:var(--s4vp-surface);color:var(--s4vp-text);font-size:14px;text-align:left;cursor:pointer}
.s4vp-adv-result:hover,.s4vp-adv-result:focus-visible{background:var(--s4vp-accent-soft)}
.s4vp-adv-result[disabled]{color:var(--s4vp-sub);background:#F7F8F9;cursor:default}
.s4vp-adv-result-n{font-weight:600;min-width:0;overflow-wrap:anywhere}
.s4vp-adv-hint{padding:8px 12px;font-size:13px;color:var(--s4vp-sub)}
.s4vp-adv-lines{flex:0 0 auto;border:1px solid var(--s4vp-line);border-radius:8px;max-height:214px;overflow:auto}
.s4vp-adv-top,.s4vp-adv-find{flex:0 0 auto}
.s4vp-adv-lines .s4vp-empty{padding:14px}
.s4vp-adv-bad td{background:#FDF3F1}
.s4vp-adv-sum{margin-right:auto;align-self:center;font-size:13px;color:var(--s4vp-sub);font-variant-numeric:tabular-nums}
@media (max-width:812px){.s4vp-adv-top{grid-template-columns:1fr 1fr}}
.s4vp-rp{display:flex;flex-direction:column;gap:var(--s4vp-gap);min-width:0}
.s4vp-rp-block{min-width:0}
.s4vp-rp-hub{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--s4vp-gap);align-items:start}
.s4vp-rp-group{background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;display:flex;flex-direction:column;min-width:0}
.s4vp-rp-group-h{padding:10px 14px 8px;border-bottom:1px solid var(--s4vp-line)}
.s4vp-rp-group-h h2{font-size:16px;font-weight:700;line-height:1.3}
.s4vp-rp-item{padding:10px 14px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--s4vp-line-soft)}
.s4vp-rp-item:last-child{border-bottom:0}
.s4vp-rp-item-t{font-size:14px;font-weight:700}
.s4vp-rp-item-d{font-size:13px;color:var(--s4vp-sub)}
.s4vp-rp-item-f{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:2px}
.s4vp-rp-item-p{font-size:13px;min-width:0}
.s4vp-rp-item-k{color:var(--s4vp-sub)}
.s4vp-rp-item-f .s4vp-btn{flex:0 0 auto}
.s4vp-rp-notes{display:flex;flex-wrap:wrap;gap:6px 8px}
.s4vp-rp-note{font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--s4vp-line);background:var(--s4vp-surface);color:var(--s4vp-sub)}
.s4vp-rp-note-warn{color:var(--s4vp-warn);background:var(--s4vp-warn-bg);border-color:#F0D3A6}
.s4vp-rp-note-error{color:var(--s4vp-err);background:var(--s4vp-err-bg);border-color:#F1BDB7;font-weight:600}
.s4vp-rp-note-ok{color:var(--s4vp-ok);background:var(--s4vp-ok-bg);border-color:#B7DFC5}
.s4vp-rp-tabs{padding:2px 12px 0}
.s4vp-rp-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.s4vp-rp-grid{min-width:0}
.s4vp-rp-grid .s4vp-tbl td{font-size:13px;padding:6px 8px}
.s4vp-rp-grid .s4vp-tbl th{padding:6px 8px}
.s4vp-rp-grid .s4vp-tbl th:first-child,.s4vp-rp-grid .s4vp-tbl td:first-child{padding-left:12px}
.s4vp-rp-grid .s4vp-tbl th:last-child,.s4vp-rp-grid .s4vp-tbl td:last-child{padding-right:12px}
.s4vp-rp-grid .s4vp-tbl-sticky tr.s4vp-total td{position:sticky;bottom:0;background:#F7F8F9;box-shadow:inset 0 1px 0 #D9DEE2}
.s4vp-rp-grid .s4vp-tbl tbody tr.s4vp-row:hover td{background:#F4F7F9}
.s4vp-rp-pin .s4vp-tbl th:first-child,.s4vp-rp-pin .s4vp-tbl td:first-child{position:sticky;left:0;z-index:1;background:var(--s4vp-surface);box-shadow:inset -1px 0 0 var(--s4vp-line)}
.s4vp-rp-pin .s4vp-tbl th:first-child{z-index:2;background:#F7F8F9}
.s4vp-rp-pin .s4vp-tbl tr.s4vp-total td:first-child{background:#F7F8F9;z-index:2}
.s4vp-rp-pager{display:inline-flex;gap:6px;align-items:center}
.s4vp-rp-name{display:block;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s4vp-rp-bad{color:var(--s4vp-err);font-weight:700}
.s4vp-rp-narrow{max-width:860px}
.s4vp-rp-sheet{display:flex;flex-direction:column;gap:8px;padding:10px 0 0;min-width:0}
.s4vp-rp-sheet > .s4vp-rp-notes,.s4vp-rp-sheet-h{margin:0 12px}
.s4vp-rp-sheet-h{display:flex;flex-wrap:wrap;gap:6px 28px}
.s4vp-rp-kv{display:flex;flex-direction:column;min-width:0;font-size:14px}
.s4vp-rp-sub{border-top:1px solid var(--s4vp-line);min-width:0}
.s4vp-rp-sub-h{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;padding:8px 12px 0}
.s4vp-rp-docs{display:inline-flex;gap:6px;flex-wrap:nowrap}
/* HR (views/employees.js): prefix s4vp-hr- */
.s4vp-hr{display:contents}
.s4vp-hr-find{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.s4vp-hr-find > .s4vp-in{flex:1 1 320px;max-width:460px;min-height:40px;font-size:15px}
.s4vp-hr .s4vp-tbl td{font-size:13px;padding:6px 8px}
.s4vp-hr .s4vp-tbl th{padding:6px 8px}
.s4vp-hr .s4vp-tbl th:first-child,.s4vp-hr .s4vp-tbl td:first-child{padding-left:12px}
.s4vp-hr .s4vp-tbl th:last-child,.s4vp-hr .s4vp-tbl td:last-child{padding-right:12px}
.s4vp-hr .s4vp-tbl-bar{padding:6px 12px}
.s4vp-hr .s4vp-tbl-bar .s4vp-in{min-height:32px}
.s4vp-hr .s4vp-tbl .s4vp-badge{padding:2px 7px}
.s4vp-hr .s4vp-empty{padding:18px 12px}
.s4vp-hr-name{display:flex;flex-direction:column;min-width:0}
.s4vp-hr-name b{font-weight:600}
.s4vp-hr-name.s4vp-hr-nw{white-space:nowrap}
.s4vp-hr-name span{font-size:12px;color:var(--s4vp-sub)}
.s4vp-hr-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.s4vp-hr-nw{flex-wrap:nowrap;white-space:nowrap}
.s4vp-hr-pager{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;padding:4px 12px;border-top:1px solid var(--s4vp-line);font-size:13px;color:var(--s4vp-sub)}
.s4vp-hr-pager .s4vp-btn{min-height:30px;padding:0 10px}
.s4vp-hr-pager-nav{display:flex;gap:6px;align-items:center}
.s4vp-hr-side > .s4vp-side{max-height:max(300px,calc(100vh - 296px));overflow-y:auto}
.s4vp-hr-side-ctl{display:flex;gap:8px;align-items:center}
.s4vp-hr-side-ctl .s4vp-in{min-height:32px}
.s4vp-hr-due{display:flex;flex-direction:column}
.s4vp-hr-due-item{display:flex;gap:10px;align-items:center;justify-content:space-between;width:100%;min-height:40px;padding:5px 6px;border:0;border-bottom:1px solid var(--s4vp-line-soft);border-radius:0;background:none;color:var(--s4vp-text);font-size:13px;text-align:left;cursor:pointer}
.s4vp-hr-due-item:hover{background:var(--s4vp-accent-soft)}
.s4vp-hr-due-static{cursor:default}
.s4vp-hr-due-static:hover{background:none}
.s4vp-hr-due-who{display:flex;flex-direction:column;min-width:0}
.s4vp-hr-due-who b{font-weight:600;overflow-wrap:anywhere}
.s4vp-hr-due-who span{font-size:12px;color:var(--s4vp-sub)}
.s4vp-hr-due-when{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex:0 0 auto;font-variant-numeric:tabular-nums}
.s4vp-hr-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(136px,1fr));gap:6px 16px;background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;padding:8px 14px}
.s4vp-hr-fact{display:flex;flex-direction:column;gap:1px;min-width:0}
.s4vp-hr-fact-l{font-size:12px;color:var(--s4vp-sub)}
.s4vp-hr-fact-v{font-size:14px;font-weight:600;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.s4vp-hr-err{color:var(--s4vp-err);font-weight:600}
.s4vp-hr-errbox{color:var(--s4vp-err);background:var(--s4vp-err-bg);border:1px solid #F1BDB7;border-radius:8px;padding:8px 12px;font-size:13px;overflow-wrap:anywhere}
.s4vp-hr-note{color:var(--s4vp-sub);font-size:13px;overflow-wrap:anywhere}
.s4vp-hr-tl{display:flex;flex-direction:column;max-height:max(240px,calc(100vh - 372px));overflow-y:auto}
.s4vp-hr-tl-row{display:grid;grid-template-columns:84px minmax(0,1fr) auto;gap:10px;padding:6px 12px;border-bottom:1px solid var(--s4vp-line-soft);align-items:baseline;font-size:13px}
.s4vp-hr-tl-date{font-variant-numeric:tabular-nums;color:var(--s4vp-sub)}
.s4vp-hr-tl-text{display:flex;flex-direction:column;min-width:0;overflow-wrap:anywhere}
.s4vp-hr-tl-text b{font-weight:600}
.s4vp-hr-tl-text span{font-size:12px;color:var(--s4vp-sub)}
.s4vp-hr-tl-soft{color:var(--s4vp-sub)}
.s4vp-hr-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.s4vp-hr-bar .s4vp-btn{min-height:32px;padding:0 12px}
.s4vp-hr-tabwrap{max-height:max(220px,calc(100vh - 388px))}
.s4vp-hr-alloc{display:flex;flex-direction:column;gap:6px;max-height:44vh;overflow:auto}
.s4vp-hr-alloc-row{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr)) 84px 36px;gap:6px;align-items:center}
.s4vp-hr-alloc-head{font-size:12px;color:var(--s4vp-sub)}
.s4vp-hr-sub{font-size:12px;font-weight:600;color:var(--s4vp-sub);padding:8px 12px 2px}
@media (max-width:812px){.s4vp-hr-alloc-row{grid-template-columns:1fr 1fr}.s4vp-hr-tl-row{grid-template-columns:84px minmax(0,1fr)}}
.s4vp-out-period{display:inline-flex}
.s4vp-out-period .s4vp-in{min-height:36px}
.s4vp-out-todo{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;padding:6px 12px;background:var(--s4vp-warn-bg);border:1px solid #F3D49B;border-radius:12px}
.s4vp-out-todo-l{font-size:13px;font-weight:700;color:var(--s4vp-warn);margin-right:4px}
.s4vp-out-todo-btn{font-size:13px;min-height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--s4vp-warn-line);background:var(--s4vp-surface);color:var(--s4vp-warn);white-space:nowrap;cursor:pointer}
.s4vp-out-todo-btn.s4vp-on{background:var(--s4vp-warn);border-color:var(--s4vp-warn);color:#FFFFFF}
.s4vp-out-todo .s4vp-btn{min-height:32px}
.s4vp-out-clip{display:block;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s4vp-out-status{display:inline-flex;gap:6px;align-items:center}
.s4vp-out-flag{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--s4vp-warn-bg);color:var(--s4vp-warn);font-size:12px;font-weight:700}
.s4vp-out-diff{color:var(--s4vp-err);font-weight:700}
.s4vp-out-plain{font-variant-numeric:tabular-nums}
.s4vp-out-side > .s4vp-side{max-height:max(316px,calc(100vh - 328px));overflow-y:auto;gap:10px}
.s4vp-out-side > .s4vp-side > *{flex-shrink:0}
.s4vp-out-body > *{flex-shrink:0}
.s4vp-out-side-low > .s4vp-side{max-height:max(296px,calc(100vh - 376px))}
.s4vp-out-side .s4vp-side-h .s4vp-btn{min-height:32px}
.s4vp-out-steps{display:flex;flex-wrap:nowrap;gap:3px;align-items:center;overflow-x:auto;padding-bottom:1px}
.s4vp-out-steps .s4vp-out-step{padding:0 8px 0 3px;font-size:12px;gap:4px;flex:0 0 auto}
.s4vp-out-steps .s4vp-out-step-n{width:20px;height:20px;font-size:11px}
.s4vp-out-step{display:inline-flex;gap:6px;align-items:center;min-height:32px;padding:0 10px 0 4px;border:1px solid var(--s4vp-line);border-radius:999px;background:var(--s4vp-surface);color:var(--s4vp-sub);font-size:13px;cursor:pointer;white-space:nowrap}
.s4vp-out-step-n{width:22px;height:22px;border-radius:50%;border:1px solid var(--s4vp-ctl);display:inline-flex;align-items:center;justify-content:center;font-size:12px}
.s4vp-out-step-done{color:var(--s4vp-ok)}
.s4vp-out-step-done .s4vp-out-step-n{background:var(--s4vp-ok-bg);border-color:var(--s4vp-ok-bg);font-weight:700}
.s4vp-out-step-cur{color:var(--s4vp-text);font-weight:700}
.s4vp-out-step-cur .s4vp-out-step-n{background:var(--s4vp-accent);border-color:var(--s4vp-accent);color:#FFFFFF}
.s4vp-out-step-on{border-color:var(--s4vp-accent);box-shadow:inset 0 0 0 1px var(--s4vp-accent);background:var(--s4vp-accent-soft)}
.s4vp-out-issues{display:flex;flex-direction:column;gap:6px}
.s4vp-out-issue{display:flex;gap:10px;align-items:center;justify-content:space-between;font-size:13px;padding:3px 4px 3px 10px;min-height:32px;border-radius:8px;background:var(--s4vp-warn-bg);color:var(--s4vp-warn)}
.s4vp-out-issue .s4vp-btn{min-height:30px;flex:0 0 auto}
.s4vp-out-body{display:flex;flex-direction:column;gap:8px;min-width:0}
.s4vp-out-box{border:1px solid var(--s4vp-line);border-radius:10px;overflow:hidden}
.s4vp-out-box .s4vp-tbl-bar{padding:6px 8px}
.s4vp-out-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.s4vp-out-method{display:inline-flex}
.s4vp-out-dirty{font-size:12px;font-weight:600;color:#8A4B00}
.s4vp-out-sum{margin-left:auto;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.s4vp-out-warn{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--s4vp-warn-bg);color:var(--s4vp-warn)}
.s4vp-out-warn.s4vp-out-err{background:var(--s4vp-err-bg);color:var(--s4vp-err)}
.s4vp-out-okay{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--s4vp-ok-bg);color:var(--s4vp-ok)}
.s4vp-out-err{color:var(--s4vp-err);font-size:12px}
.s4vp-out-bar{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;justify-content:space-between}
.s4vp-out-bar > .s4vp-small{flex:1 1 200px;min-width:0}
.s4vp-out-bar .s4vp-in{min-height:32px}
.s4vp-out-grid{border:1px solid var(--s4vp-line);border-radius:10px;overflow:auto;max-height:max(200px,calc(100vh - 520px))}
.s4vp-out-grid .s4vp-tbl th{position:sticky;top:0;z-index:1}
.s4vp-out-grid .s4vp-tbl td{padding:4px 6px}
.s4vp-out-grid .s4vp-tbl th{padding:6px}
.s4vp-out-grid .s4vp-in{min-height:32px;padding:0 8px}
.s4vp-out-grid .s4vp-btn{min-height:32px}
.s4vp-out-grid .s4vp-empty{padding:14px}
.s4vp-out-uom{display:block;margin-top:2px}
.s4vp-out-fixed{font-variant-numeric:tabular-nums}
.s4vp-out-who{display:flex;flex-wrap:wrap;gap:0 8px;align-items:baseline;min-width:0}
.s4vp-out-who-n{font-weight:600;overflow-wrap:anywhere}
.s4vp-out-find{display:flex;flex-direction:column;gap:6px}
.s4vp-out-results{border:1px solid var(--s4vp-line);border-radius:8px;max-height:112px;overflow-y:auto;display:flex;flex-direction:column}
.s4vp-out-result{display:flex;gap:12px;align-items:center;justify-content:space-between;min-height:36px;padding:4px 12px;border:0;border-bottom:1px solid var(--s4vp-line-soft);background:var(--s4vp-surface);color:var(--s4vp-text);font-size:14px;text-align:left;cursor:pointer}
.s4vp-out-result:hover,.s4vp-out-result:focus-visible{background:var(--s4vp-accent-soft)}
.s4vp-out-result[disabled]{color:var(--s4vp-sub);background:#F7F8F9;cursor:default}
.s4vp-out-hint{padding:8px 12px;font-size:13px;color:var(--s4vp-sub)}
.s4vp-out-info{display:flex;flex-direction:column;gap:6px;padding:10px 0;border-top:1px solid var(--s4vp-line-soft);border-bottom:1px solid var(--s4vp-line-soft)}
.s4vp-out-info .s4vp-line{align-items:baseline}
.s4vp-out-val{text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-width:0}
/* setup hub (views/setupHub.js) */
.s4vp-st-hub{display:flex;flex-direction:column;gap:var(--s4vp-gap);min-width:0}
.s4vp-st-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;min-width:0}
.s4vp-st-bar .s4vp-tabs{border-bottom:0}
.s4vp-st-grow{flex:1 1 auto}
.s4vp-st-groups{column-width:560px;column-gap:var(--s4vp-gap)}
.s4vp-st-groups > .s4vp-card{break-inside:avoid;margin-bottom:var(--s4vp-gap)}
.s4vp-st-rows{display:flex;flex-direction:column}
.s4vp-st-row{display:grid;grid-template-columns:104px minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:8px 14px;border-top:1px solid var(--s4vp-line-soft)}
.s4vp-st-state{min-width:0}
.s4vp-st-main{display:flex;flex-direction:column;gap:1px;min-width:0}
.s4vp-st-name{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;font-weight:600;min-width:0;overflow-wrap:anywhere}
.s4vp-st-name .s4vp-small{font-weight:400}
.s4vp-st-desc{font-size:12px;color:var(--s4vp-sub);overflow-wrap:anywhere}
.s4vp-st-issue{font-size:12px;color:var(--s4vp-warn);overflow-wrap:anywhere}
.s4vp-st-issue-err{color:var(--s4vp-err)}
.s4vp-st-acts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;align-items:center}
.s4vp-tbl .s4vp-st-acts{flex-wrap:nowrap;justify-content:flex-start}
.s4vp-st-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.s4vp-st-step{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:8px 0;border-top:1px solid var(--s4vp-line-soft)}
.s4vp-st-step:first-child{border-top:0}
.s4vp-st-num{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:#EEF0F2;color:var(--s4vp-sub)}
.s4vp-st-step-done .s4vp-st-num{background:var(--s4vp-ok-bg);color:var(--s4vp-ok)}
.s4vp-st-step-current .s4vp-st-num{background:var(--s4vp-accent);color:#FFFFFF}
.s4vp-st-step-current .s4vp-st-name{color:var(--s4vp-accent-dark)}
.s4vp-st-note{font-size:13px;padding:8px 12px;border-radius:8px;background:var(--s4vp-info-bg);color:var(--s4vp-info)}
.s4vp-st-note-warn{background:var(--s4vp-warn-bg);color:var(--s4vp-warn)}
.s4vp-st-err{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--s4vp-err-bg);color:var(--s4vp-err)}
.s4vp-st-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px 14px}
.s4vp-st-form-narrow{grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px 10px}
.s4vp-st-test-btn{display:flex;align-items:flex-end}
.s4vp-st-cards{column-width:440px;column-gap:var(--s4vp-gap)}
.s4vp-st-cards > .s4vp-card{break-inside:avoid;margin-bottom:var(--s4vp-gap)}
.s4vp-st-kv{display:flex;flex-direction:column;gap:6px}
.s4vp-st-kv-row{display:flex;justify-content:space-between;gap:12px;font-size:14px;align-items:baseline}
.s4vp-st-kv-row > span:first-child{flex:1 1 auto;min-width:0}
.s4vp-st-kv-row > span:last-child{text-align:right;max-width:55%;overflow-wrap:anywhere}
.s4vp-st-val{font-weight:600}
.s4vp-st-cell{display:flex;flex-direction:column;gap:1px;min-width:0}
.s4vp-st-side{gap:var(--s4vp-gap)}
.s4vp-st-prio{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:3px;font-size:13px}
.s4vp-st-result{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid var(--s4vp-line-soft)}
.s4vp-st-result-h{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.s4vp-st-result-v{font-size:16px;font-weight:700;color:var(--s4vp-accent-dark)}
.s4vp-st-levels{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;font-size:13px}
.s4vp-st-level{display:flex;justify-content:space-between;gap:12px;padding:3px 8px;border-radius:6px}
.s4vp-st-level-on{background:var(--s4vp-accent-soft);font-weight:600}
.s4vp-st-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
@media (max-width:812px){.s4vp-st-groups,.s4vp-st-cards{column-width:auto;column-count:1}.s4vp-st-row{grid-template-columns:1fr}.s4vp-st-acts{justify-content:flex-start}}
.s4vp-req{color:var(--s4vp-err);font-weight:700}
input[type="date"].s4vp-in,input[type="month"].s4vp-in,input[type="time"].s4vp-in{padding:0 8px 0 10px;font-variant-numeric:tabular-nums}
input[type="number"].s4vp-in{padding-right:4px}
.s4vp-check{display:inline-flex;align-items:center;gap:8px;min-height:36px;font-size:14px;color:var(--s4vp-text);cursor:pointer}
.s4vp-check-in{width:18px;height:18px;margin:0;accent-color:var(--s4vp-accent);flex:0 0 auto}
.s4vp-ss{position:relative;width:100%;min-width:0}
.s4vp-ss-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer;padding-right:10px}
.s4vp-ss-val{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s4vp-ss-ph .s4vp-ss-val{color:var(--s4vp-sub)}
.s4vp-ss-caret{flex:0 0 auto;color:var(--s4vp-sub)}
.s4vp-ss-pop{position:absolute;top:100%;left:0;right:0;min-width:260px;margin-top:4px;background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:10px;box-shadow:0 8px 24px rgba(29,39,48,.16);padding:6px;z-index:950;display:flex;flex-direction:column;gap:6px}
.s4vp-ss-list{max-height:260px;overflow-y:auto;display:flex;flex-direction:column}
.s4vp-ss-opt{background:none;border:0;border-radius:6px;text-align:left;min-height:34px;padding:6px 10px;font-size:14px;color:var(--s4vp-text);overflow-wrap:anywhere}
.s4vp-ss-opt:hover,.s4vp-ss-opt.s4vp-on{background:var(--s4vp-accent-soft)}
.s4vp-ss-opt.s4vp-sel{font-weight:600;color:var(--s4vp-accent-dark)}
.s4vp-ss-note{padding:6px 10px;font-size:12px;color:var(--s4vp-sub)}
/* Commission (views/commission.js): prefix s4vp-cm- */
.s4vp-cm{display:flex;flex-direction:column;gap:var(--s4vp-gap);min-width:0}
.s4vp-cm .s4vp-tbl td{font-size:13px;padding:6px 8px}
.s4vp-cm .s4vp-tbl th{padding:6px 8px}
.s4vp-cm .s4vp-tbl th:first-child,.s4vp-cm .s4vp-tbl td:first-child{padding-left:12px}
.s4vp-cm .s4vp-tbl th:last-child,.s4vp-cm .s4vp-tbl td:last-child{padding-right:12px}
.s4vp-cm .s4vp-tbl-bar{padding:6px 12px}
.s4vp-cm .s4vp-tbl-bar .s4vp-in{min-height:32px}
.s4vp-cm .s4vp-tbl-bar .s4vp-btn{min-height:32px}
.s4vp-cm .s4vp-tbl .s4vp-badge{padding:2px 7px}
.s4vp-cm .s4vp-tbl-sticky tr.s4vp-total td{position:sticky;bottom:0;background:#F7F8F9;box-shadow:inset 0 1px 0 #D9DEE2}
.s4vp-cm .s4vp-empty{padding:18px 12px}
.s4vp-cm-month{display:inline-flex}
.s4vp-cm-month .s4vp-in{min-height:36px}
.s4vp-cm-side > .s4vp-side{max-height:max(316px,calc(100vh - 300px));overflow-y:auto;gap:10px}
.s4vp-cm-side > .s4vp-side > *{flex-shrink:0}
.s4vp-cm-side .s4vp-tabs{gap:0}
.s4vp-cm-body{display:flex;flex-direction:column;gap:8px;min-width:0}
.s4vp-cm-body > *{flex-shrink:0}
.s4vp-cm-info{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-top:1px solid var(--s4vp-line-soft);border-bottom:1px solid var(--s4vp-line-soft)}
.s4vp-cm-info .s4vp-line{align-items:baseline;font-size:13px}
.s4vp-cm-val{text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-width:0}
.s4vp-cm-strong{font-weight:700}
.s4vp-cm-sub{font-size:14px;font-weight:700}
.s4vp-cm-sub .s4vp-small{font-weight:400}
.s4vp-cm-box{border:1px solid var(--s4vp-line);border-radius:10px;overflow:hidden;min-width:0}
.s4vp-cm-box .s4vp-tbl-bar{padding:6px 8px}
.s4vp-cm-side .s4vp-cm-box .s4vp-tbl td{font-size:13px;padding:5px 6px}
.s4vp-cm-side .s4vp-cm-box .s4vp-tbl th{padding:5px 6px}
.s4vp-cm-steps{margin:0;padding:0 0 0 20px;display:flex;flex-direction:column;gap:4px;font-size:13px;font-variant-numeric:tabular-nums}
.s4vp-cm-steps li{overflow-wrap:anywhere}
.s4vp-cm-who{display:flex;flex-direction:column;gap:1px;min-width:0}
.s4vp-cm-who-n{font-weight:600;overflow-wrap:anywhere}
.s4vp-cm-clip{display:block;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s4vp-cm-warn{display:flex;flex-direction:column;gap:2px;font-size:13px;padding:8px 10px;border-radius:8px;background:var(--s4vp-warn-bg);color:var(--s4vp-warn)}
.s4vp-cm-warn.s4vp-cm-bad{background:var(--s4vp-err-bg);color:var(--s4vp-err)}
.s4vp-cm-note{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--s4vp-info-bg);color:var(--s4vp-info)}
.s4vp-cm-err{color:var(--s4vp-err);font-size:12px}
.s4vp-cm-dirty{font-size:12px;font-weight:600;color:#8A4B00}
.s4vp-cm-adj{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 10px}
.s4vp-cm-pair{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:8px 10px;align-items:start}
.s4vp-cm-form{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px 12px}
.s4vp-cm-methods{margin:0;display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--s4vp-sub)}
.s4vp-cm-method{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px;padding:3px 6px;border-radius:6px}
.s4vp-cm-method dt{font-weight:600;margin:0}
.s4vp-cm-method dd{margin:0}
.s4vp-cm-method.s4vp-on{background:var(--s4vp-accent-soft);color:var(--s4vp-accent-dark)}
.s4vp-cm-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.s4vp-cm-chip{display:inline-flex;align-items:center;gap:2px;font-size:13px;padding:0 2px 0 10px;min-height:30px;border-radius:999px;background:var(--s4vp-accent-soft);color:var(--s4vp-accent-dark);max-width:100%}
.s4vp-cm-chip > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s4vp-cm-chip-x{background:none;border:0;min-width:26px;min-height:26px;border-radius:50%;font-size:15px;line-height:1;color:inherit}
.s4vp-cm-chip-x:hover{background:rgba(0,0,0,.08)}
.s4vp-cm-chip-add{flex:1 1 140px;min-width:140px;max-width:240px}
.s4vp-cm-chip-add .s4vp-in{min-height:30px}
.s4vp-cm-edit .s4vp-tbl-wrap{overflow:visible}
.s4vp-cm-edit .s4vp-tbl td{padding:4px 6px}
.s4vp-cm-edit .s4vp-tbl .s4vp-in{min-height:32px;padding:0 8px}
.s4vp-cm-pad{padding:4px 8px 6px}
.s4vp-cm-dlg-l{margin-right:auto;display:inline-flex}
.s4vp-cm-imp-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:8px 12px;align-items:start}
.s4vp-cm-file{padding:5px 8px}
.s4vp-cm-map{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px 10px}
.s4vp-cm-map .s4vp-in{min-height:32px}
@media (max-width:812px){.s4vp-cm-adj,.s4vp-cm-imp-top,.s4vp-cm-pair{grid-template-columns:1fr}.s4vp-cm-method{grid-template-columns:1fr}}
`;

let done = false;

// Chèn CSS một lần; gọi ở đầu mỗi lần vẽ khung cũng không sao (đã có thẻ thì bỏ qua)
export function ensureCss() {
	try {
		if (done) return;
		let st = document.getElementById('s4vp-css');
		if (!st) {
			st = document.createElement('style');
			st.id = 's4vp-css';
			document.head.appendChild(st);
		}
		st.textContent = CSS;
		done = true;
	} catch (e) {
		// không có document (kiểm thử): bỏ qua
	}
}
