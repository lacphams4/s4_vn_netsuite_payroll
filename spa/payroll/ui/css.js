/**
 * CSS chung của giao diện bản 2 (tiền tố lớp s4vp-), chèn một lần vào document.head bằng ensureCss().
 * Màu, bo góc, khoảng cách theo mẫu docs/design/*.dc.html; phông chữ kế thừa trang NetSuite.
 * Vùng bấm cao tối thiểu 36 px; số tiền căn phải, tabular-nums.
 */
const CSS = `
.s4vp-app{--s4vp-bg:#F3F4F2;--s4vp-surface:#FFFFFF;--s4vp-text:#1D2730;--s4vp-sub:#55616B;--s4vp-accent:#24566B;--s4vp-accent-dark:#16394A;--s4vp-accent-soft:#E6EFF3;--s4vp-line:#E1E5E8;--s4vp-line-soft:#E8EBEE;--s4vp-ctl:#B8C1C8;
--s4vp-ok:#0F5132;--s4vp-ok-bg:#DDF1E4;--s4vp-warn:#6B3A00;--s4vp-warn-bg:#FFE9C7;--s4vp-warn-line:#C97A12;--s4vp-err:#8A1C14;--s4vp-err-bg:#FBE3E0;--s4vp-info:#16394A;--s4vp-info-bg:#E6EFF3;
font-family:inherit;font-size:14px;line-height:1.4;color:var(--s4vp-text);background:var(--s4vp-bg);min-height:80vh;height:max-content;width:100%;flex:0 0 auto;box-sizing:border-box;text-align:left}
.s4vp-app *,.s4vp-app *::before,.s4vp-app *::after{box-sizing:border-box}
:where(.s4vp-app) button,:where(.s4vp-app) input,:where(.s4vp-app) select,:where(.s4vp-app) textarea{font:inherit;color:inherit;margin:0}
.s4vp-app button{cursor:pointer}
.s4vp-app button[disabled]{cursor:not-allowed;opacity:.55}
.s4vp-app button:focus-visible,.s4vp-app input:focus-visible,.s4vp-app select:focus-visible,.s4vp-app textarea:focus-visible{outline:2px solid var(--s4vp-accent);outline-offset:1px}
.s4vp-app h1,.s4vp-app h2,.s4vp-app h3{margin:0;font-family:inherit;color:inherit}

.s4vp-nav{background:var(--s4vp-surface);border-bottom:1px solid #D9DEE2;padding:0 28px;display:flex;flex-wrap:wrap;gap:2px 6px;align-items:center}
.s4vp-brand{font-size:17px;font-weight:700;padding:0 18px 0 0;white-space:nowrap}
.s4vp-navtab{background:none;border:0;border-bottom:3px solid transparent;color:#3A4650;padding:14px 12px 11px;font-size:14px;min-height:44px;white-space:nowrap}
.s4vp-navtab:hover{color:var(--s4vp-accent-dark)}
.s4vp-navtab.s4vp-on{color:var(--s4vp-accent-dark);border-bottom-color:var(--s4vp-accent);font-weight:700}
.s4vp-navright{margin-left:auto;display:flex;align-items:center;gap:8px;padding:6px 0}
.s4vp-navright .s4vp-lbl{font-size:12px;color:var(--s4vp-sub);white-space:nowrap}
.s4vp-busy{display:inline-flex;gap:8px;align-items:center;font-size:13px;color:var(--s4vp-sub);max-width:320px;overflow:hidden;white-space:nowrap}
.s4vp-strip{margin:12px 28px 0;padding:10px 14px;border-radius:8px;display:flex;gap:12px;align-items:flex-start;justify-content:space-between;font-size:14px;border:1px solid transparent}
.s4vp-strip-ok{color:var(--s4vp-ok);background:var(--s4vp-ok-bg);border-color:#B7DFC5}
.s4vp-strip-warn{color:var(--s4vp-warn);background:var(--s4vp-warn-bg);border-color:#F0D3A6}
.s4vp-strip-error{color:var(--s4vp-err);background:var(--s4vp-err-bg);border-color:#F1BDB7}
.s4vp-strip-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap;align-self:center}
.s4vp-x{background:none;border:0;min-width:36px;min-height:36px;border-radius:8px;font-size:18px;line-height:1;color:inherit;flex:0 0 auto}
.s4vp-x:hover{background:rgba(0,0,0,.07)}
.s4vp-spin{width:16px;height:16px;border-radius:50%;border:2px solid var(--s4vp-ctl);border-top-color:var(--s4vp-accent);animation:s4vp-rot .8s linear infinite;flex:0 0 auto;align-self:center}
@keyframes s4vp-rot{to{transform:rotate(360deg)}}

.s4vp-page{padding:24px 76px 40px 28px;display:flex;flex-direction:column;gap:18px;min-width:0}
.s4vp-ph{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;justify-content:space-between}
.s4vp-ph-main{display:flex;flex-direction:column;gap:6px;min-width:0}
.s4vp-crumbs{font-size:13px;color:var(--s4vp-sub);display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.s4vp-ph-title{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.s4vp-ph-title h1{font-size:26px;font-weight:700;line-height:1.2}
.s4vp-ph-sub{font-size:13px;color:var(--s4vp-sub)}
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

.s4vp-steps{list-style:none;margin:0;padding:14px 18px;background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;display:flex;flex-wrap:wrap;gap:10px 28px;font-size:14px}
.s4vp-step{display:flex;gap:8px;align-items:center;color:var(--s4vp-sub);margin:0;padding:0}
.s4vp-step-n{width:24px;height:24px;border-radius:50%;border:1px solid var(--s4vp-ctl);display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex:0 0 auto}
.s4vp-step-note{font-size:12px;color:var(--s4vp-sub);font-weight:400}
.s4vp-step-done{color:var(--s4vp-ok)}
.s4vp-step-done .s4vp-step-n{background:var(--s4vp-ok-bg);border-color:var(--s4vp-ok-bg);font-weight:700}
.s4vp-step-current{color:var(--s4vp-text);font-weight:700}
.s4vp-step-current .s4vp-step-n{background:var(--s4vp-accent);border-color:var(--s4vp-accent);color:#FFFFFF;font-weight:700}
.s4vp-step-note.s4vp-t-warn{color:#8A4B00;font-weight:600}
.s4vp-step-note.s4vp-t-error{color:var(--s4vp-err);font-weight:600}
.s4vp-step-note.s4vp-t-ok{color:var(--s4vp-ok)}
.s4vp-step-btn{background:none;border:0;padding:0;min-height:36px;display:flex;gap:8px;align-items:center;color:inherit;font-weight:inherit}

.s4vp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.s4vp-stat{background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:6px;min-width:0}
.s4vp-stat-l{font-size:13px;color:var(--s4vp-sub)}
.s4vp-stat-v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
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
.s4vp-card-h{padding:14px 16px 10px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between}
.s4vp-card-t{font-size:16px;font-weight:700}
.s4vp-card-s{font-size:13px;color:var(--s4vp-sub);font-weight:400}
.s4vp-card-b{padding:16px 18px;display:flex;flex-direction:column;gap:14px;min-width:0}
.s4vp-card-h + .s4vp-card-b{padding-top:4px}
.s4vp-card-flush{padding:0;gap:0}
.s4vp-card-h + .s4vp-card-flush{padding-top:0}

.s4vp-tbl-bar{padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.s4vp-tbl-bar-l{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}
.s4vp-tbl-bar-r{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-left:auto}
.s4vp-tbl-count{font-size:12px;color:var(--s4vp-sub)}
.s4vp-tbl-wrap{overflow-x:auto;max-width:100%}
.s4vp-tbl{border-collapse:collapse;width:100%}
.s4vp-tbl th{font-size:12px;font-weight:600;color:var(--s4vp-sub);text-align:left;padding:10px 12px;border-bottom:1px solid #D9DEE2;white-space:nowrap;background:#F7F8F9}
.s4vp-tbl td{font-size:14px;padding:12px;border-bottom:1px solid var(--s4vp-line-soft);text-align:left;vertical-align:middle;font-variant-numeric:tabular-nums;color:var(--s4vp-text)}
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

.s4vp-cols{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start}
.s4vp-col-main{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:18px}
.s4vp-side{flex:1 1 340px;max-width:420px;min-width:0;background:var(--s4vp-surface);border:1px solid var(--s4vp-line);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.s4vp-side-h{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.s4vp-side-t{font-size:17px;font-weight:700}
.s4vp-side-s{font-size:13px;color:var(--s4vp-sub)}
.s4vp-empty{padding:28px 16px;text-align:center;color:var(--s4vp-sub);font-size:14px}
.s4vp-row{}
.s4vp-line{display:flex;justify-content:space-between;gap:12px;font-size:14px}
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
