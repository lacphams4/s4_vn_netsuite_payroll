/**
 * Phân tích chi phí lương (docs/UI_V2.md mục 13): chi phí lao động của một tháng so với kỳ so sánh, đặt cạnh doanh thu,
 * giá vốn và chi phí hoạt động của sổ cái. Thẻ chỉ số, xu hướng 12 tháng, cầu biến động, bảng phân rã theo chiều (bấm một
 * dòng để xem tới nhân viên), bảng lãi lỗ có tách phần lao động và đối chiếu sổ cái.
 *
 * Biểu đồ vẽ bằng div + CSS (không dùng phần tử SVG trong JSX: chưa chắc VDom của UIF tạo phần tử đúng namespace SVG);
 * riêng đường tỷ lệ là một ảnh SVG nền (data URI) kéo giãn theo khung, các chấm và nhãn số vẫn là div nên không có ảnh nền
 * vẫn đọc được. Không dùng hai trục trên một ô vẽ: tỷ lệ trên doanh thu và số tiền nằm ở hai dải chung trục tháng.
 * Màu chuỗi đã kiểm bằng bộ kiểm bảng màu (phân biệt được khi mù màu, tương phản >= 3:1 trên nền trắng); chữ luôn dùng
 * màu chữ của giao diện, không dùng màu chuỗi.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post, errorText, download} from '../lib/api.js';
import {money, num} from '../lib/format.js';
import {pick} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Menu, StatCards, Chips, Table, Badge, Select, TextInput, Dialog, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		title: 'Phân tích chi phí lương',
		month: 'Tháng',
		monthType: 'Gõ tháng (YYYY-MM)',
		compare: 'So với',
		compareOpt: {prev: 'Tháng trước', yoy: 'Cùng kỳ năm trước', custom: 'Chọn tháng...'},
		compareType: 'Gõ tháng so sánh (YYYY-MM)',
		reload: 'Tải lại',
		more: 'Thao tác khác',
		rebuildMonth: (m) => `Lập lại số liệu tháng ${m}`,
		rebuildAll: 'Lập lại toàn bộ số liệu phân tích',
		exportCsv: 'Xuất CSV bảng phân rã',
		csv: 'Xuất CSV',
		close: 'Đóng',
		retry: 'Thử lại',
		loading: 'Đang tải số liệu phân tích...',
		loadingShort: 'Đang tải...',
		loadFailed: 'Không tải được số liệu phân tích.',
		noSubsidiary: 'Chưa chọn công ty con.',
		acctOnly: 'Màn hình này dành cho kế toán. Vai trò của bạn không xem được phân tích chi phí lương; hãy dùng vai trò Kế toán lương hoặc Administrator.',
		confirmRebuildMonth: (m) => `Lập lại số liệu phân tích của tháng ${m} từ các bảng lương đã ghi sổ? Số liệu hiện có của tháng này được thay bằng số liệu mới.`,
		confirmRebuildAll: 'Lập lại số liệu phân tích cho mọi bảng lương đã ghi sổ của công ty con này? Việc này có thể mất vài phút.',
		rebuilding: 'Đang lập lại số liệu phân tích...',
		rebuilt: (n) => `Đã lập lại số liệu phân tích cho ${n} bảng lương.`,
		noFactsTitle: 'Chưa có số liệu phân tích',
		noFacts: 'Số liệu phân tích được ghi khi bảng lương được ghi sổ. Tháng này chưa có bảng lương nào đã ghi sổ, hoặc bảng lương được ghi sổ trước khi có chức năng này. Nếu đã ghi sổ, hãy lập lại số liệu.',
		rebuildNow: 'Lập lại số liệu',
		goPayroll: 'Mở Chạy lương',
		outdated: 'Có bảng lương đã ghi sổ hoặc đã đảo sau lần lập số liệu gần nhất. Hãy lập lại số liệu để số phân tích khớp sổ lương.',
		noGl: 'Vai trò của bạn không đọc được sổ cái: các ô theo doanh thu, giá vốn và chi phí hoạt động hiện "-". Phần chi phí lương vẫn đầy đủ.',
		noCompare: (m) => `Kỳ so sánh ${m} chưa có số liệu: các cột so sánh và cầu biến động để trống.`,
		vs: (m) => `so với ${m}`,
		unit: {bn: 'tỷ', mn: 'tr', th: 'nghìn'},
		points: 'điểm %',
		people: 'người',
		perHeadShort: 'bình quân',
		noGlShort: 'không đọc được sổ cái',
		kpi: {
			labor: 'Chi phí lao động',
			toRevenue: 'Chi phí lao động / Doanh thu',
			inCogs: 'Lao động trong giá vốn',
			inOpex: 'Lao động trong chi phí hoạt động',
			headcount: 'Số người',
			overtime: 'Tỷ trọng làm thêm',
			ofCogs: (p) => `${p} giá vốn`,
			ofOpex: (p) => `${p} CP hoạt động`,
			was: (p) => `so với ${p}`,
			worse: 'tăng',
			better: 'giảm',
			flat: 'không đổi',
		},
		trend: {
			title: 'Xu hướng 12 tháng',
			hint: 'Bấm một tháng để xem tháng đó',
			cogs: 'Lao động trong giá vốn',
			opex: 'Lao động trong chi phí hoạt động',
			ratio: 'Chi phí lao động / doanh thu (%)',
			total: 'Chi phí lao động',
			pick: (m) => `Xem tháng ${m}`,
			empty: 'Chưa có số liệu theo tháng.',
			negative: 'Cột xuống dưới trục 0: chi phí âm trong tháng (đảo lương)',
		},
		bridge: {
			title: 'Vì sao thay đổi',
			titleFor: (a, b) => `Vì sao thay đổi - từ ${a} đến ${b}`,
			up: 'Tăng',
			down: 'Giảm',
			level: 'Tổng chi phí lao động',
			none: 'Không có kỳ so sánh để dựng cầu biến động.',
			flat: 'Chi phí lao động không đổi so với kỳ so sánh.',
			step: {
				start: 'Kỳ so sánh',
				headcount: 'Số người',
				wages: 'Mức lương bình quân',
				overtime: 'Làm thêm',
				allowance: 'Phụ cấp',
				bonus: 'Thưởng',
				piecework: 'Lương khoán, sản lượng',
				other: 'Khoản khác',
				employerIns: 'BH, KPCĐ DN đóng',
				accrued13: 'Trích lương tháng 13',
				contractor: 'Cộng tác viên',
				unexplained: 'Chưa phân tích được',
				end: 'Kỳ này',
			},
		},
		comp: {
			wages: 'Lương',
			overtime: 'Làm thêm',
			allowance: 'Phụ cấp',
			bonus: 'Thưởng',
			piecework: 'Lương khoán',
			other: 'Khác',
			employerIns: 'BH, KPCĐ DN đóng',
			accrued13: 'Trích tháng 13',
			contractor: 'Cộng tác viên',
		},
		empType: {E: 'Nhân viên', C: 'Cộng tác viên'},
		dims: {department: 'Phòng ban', project: 'Dự án', class: 'Class', location: 'Địa điểm', account: 'Tài khoản', component: 'Thành phần chi phí', employmentType: 'Loại lao động'},
		dimLabel: 'Chiều phân rã',
		breakdown: {
			title: 'Phân rã chi phí lao động',
			sub: 'Sắp theo chênh lệch lớn nhất. Bấm một dòng để xem tới từng nhân viên.',
			search: 'Tìm nhóm, số tiền',
			empty: 'Không có dòng nào cho chiều này.',
			unassigned: '(Không gán)',
			total: 'Tổng',
			cols: {group: 'Nhóm', cur: 'Kỳ này', prev: 'Kỳ so sánh', diff: 'Chênh lệch', pct: '%', share: 'Tỷ trọng', headcount: 'Số người', perHead: 'Bình quân / người'},
		},
		drill: {
			title: (dim, name) => `${dim}: ${name}`,
			search: 'Tìm nhân viên, mã, số tiền',
			empty: 'Không có nhân viên nào trong nhóm này.',
			failed: 'Không tải được danh sách nhân viên.',
			hint: 'Bấm một nhân viên để mở dòng lương trong bảng lương.',
			count: (n) => `${n} nhân viên`,
			cols: {code: 'Mã', name: 'Nhân viên', department: 'Phòng ban', cur: 'Kỳ này', prev: 'Kỳ so sánh', diff: 'Chênh lệch', pct: '%'},
		},
		pnl: {
			title: 'Lãi lỗ tóm tắt',
			sub: 'Theo sổ cái; dòng "trong đó lao động" theo sổ lương',
			search: 'Tìm chỉ tiêu, số tiền',
			cols: {item: 'Chỉ tiêu', cur: 'Kỳ này', prev: 'Kỳ so sánh', diff: 'Chênh lệch', pct: '%', ofRevenue: '% doanh thu'},
			rows: {revenue: 'Doanh thu', cogs: 'Giá vốn', laborCogs: 'trong đó lao động', grossProfit: 'Lãi gộp', opex: 'Chi phí hoạt động', laborOpex: 'trong đó lao động', operatingProfit: 'Lãi trước thuế (theo sổ cái)'},
			searchAs: {laborCogs: 'lao động trong giá vốn', laborOpex: 'lao động trong chi phí hoạt động'},
		},
		recon: {
			title: 'Đối chiếu sổ cái',
			sub: 'Số theo bảng lương so với phát sinh trên sổ cái của từng tài khoản chi phí',
			ok: 'Khớp',
			off: 'Lệch',
			okText: (n) => `${n} tài khoản chi phí lương khớp sổ cái.`,
			offText: (n, amount) => `${n} tài khoản lệch, tổng chênh lệch ${amount}.`,
			show: 'Xem chi tiết',
			hide: 'Thu gọn',
			search: 'Tìm tài khoản, số tiền',
			empty: 'Không có tài khoản chi phí lương nào trong tháng.',
			noGl: 'Vai trò của bạn không đọc được sổ cái nên không đối chiếu được.',
			name: 'Tên tài khoản',
			cols: {account: 'Tài khoản', payroll: 'Theo bảng lương', gl: 'Theo sổ cái', difference: 'Chênh lệch', status: 'Kết quả'},
		},
	},
	en: {
		title: 'Labor cost analysis',
		month: 'Month',
		monthType: 'Type a month (YYYY-MM)',
		compare: 'Compare with',
		compareOpt: {prev: 'Previous month', yoy: 'Same month last year', custom: 'Pick a month...'},
		compareType: 'Type the comparison month (YYYY-MM)',
		reload: 'Refresh',
		more: 'More actions',
		rebuildMonth: (m) => `Rebuild analytics data for ${m}`,
		rebuildAll: 'Rebuild all analytics data',
		exportCsv: 'Export breakdown as CSV',
		csv: 'Export CSV',
		close: 'Close',
		retry: 'Try again',
		loading: 'Loading analytics...',
		loadingShort: 'Loading...',
		loadFailed: 'Could not load the analytics.',
		noSubsidiary: 'No subsidiary selected.',
		acctOnly: 'This screen is for accountants. Your role cannot view labor cost analysis; use the Payroll Accountant or Administrator role.',
		confirmRebuildMonth: (m) => `Rebuild analytics data for ${m} from the posted payroll batches? Existing data for this month is replaced.`,
		confirmRebuildAll: 'Rebuild analytics data for every posted payroll batch of this subsidiary? This can take a few minutes.',
		rebuilding: 'Rebuilding analytics data...',
		rebuilt: (n) => `Analytics data rebuilt for ${n} payroll batches.`,
		noFactsTitle: 'No analytics data yet',
		noFacts: 'Analytics data is written when a payroll batch is posted. This month has no posted batch, or the batch was posted before this feature existed. If it is posted, rebuild the data.',
		rebuildNow: 'Rebuild data',
		goPayroll: 'Open Run payroll',
		outdated: 'A payroll batch was posted or reversed after the analytics data was last built. Rebuild the data so the analysis matches payroll.',
		noGl: 'Your role cannot read the general ledger: figures based on revenue, cost of goods sold and operating expenses show "-". Payroll figures are complete.',
		noCompare: (m) => `The comparison period ${m} has no data: comparison columns and the variance bridge are empty.`,
		vs: (m) => `vs ${m}`,
		unit: {bn: 'bn', mn: 'M', th: 'K'},
		points: 'pts',
		people: 'person',
		perHeadShort: 'average',
		noGlShort: 'no general ledger access',
		kpi: {
			labor: 'Labor cost',
			toRevenue: 'Labor cost / Revenue',
			inCogs: 'Labor in cost of goods sold',
			inOpex: 'Labor in operating expenses',
			headcount: 'Headcount',
			overtime: 'Overtime share',
			ofCogs: (p) => `${p} of COGS`,
			ofOpex: (p) => `${p} of opex`,
			was: (p) => `vs ${p}`,
			worse: 'up',
			better: 'down',
			flat: 'unchanged',
		},
		trend: {
			title: '12-month trend',
			hint: 'Click a month to view it',
			cogs: 'Labor in cost of goods sold',
			opex: 'Labor in operating expenses',
			ratio: 'Labor cost / revenue (%)',
			total: 'Labor cost',
			pick: (m) => `View ${m}`,
			empty: 'No monthly data yet.',
			negative: 'Bars below the zero line: negative cost in the month (payroll reversal)',
		},
		bridge: {
			title: 'Why it changed',
			titleFor: (a, b) => `Why it changed - from ${a} to ${b}`,
			up: 'Increase',
			down: 'Decrease',
			level: 'Total labor cost',
			none: 'No comparison period to build the variance bridge.',
			flat: 'Labor cost is unchanged from the comparison period.',
			step: {
				start: 'Comparison period',
				headcount: 'Headcount',
				wages: 'Average pay level',
				overtime: 'Overtime',
				allowance: 'Allowances',
				bonus: 'Bonuses',
				piecework: 'Piecework, output pay',
				other: 'Other items',
				employerIns: 'Employer insurance',
				accrued13: '13th-month accrual',
				contractor: 'Contractors',
				unexplained: 'Not explained',
				end: 'This period',
			},
		},
		comp: {
			wages: 'Wages',
			overtime: 'Overtime',
			allowance: 'Allowances',
			bonus: 'Bonuses',
			piecework: 'Piecework',
			other: 'Other',
			employerIns: 'Employer insurance',
			accrued13: '13th-month accrual',
			contractor: 'Contractors',
		},
		empType: {E: 'Employees', C: 'Contractors'},
		dims: {department: 'Department', project: 'Project', class: 'Class', location: 'Location', account: 'Account', component: 'Cost component', employmentType: 'Employment type'},
		dimLabel: 'Breakdown dimension',
		breakdown: {
			title: 'Labor cost breakdown',
			sub: 'Largest variance first. Click a row to drill down to employees.',
			search: 'Search group, amount',
			empty: 'No rows for this dimension.',
			unassigned: '(Unassigned)',
			total: 'Total',
			cols: {group: 'Group', cur: 'This period', prev: 'Comparison', diff: 'Variance', pct: '%', share: 'Share', headcount: 'Headcount', perHead: 'Average / person'},
		},
		drill: {
			title: (dim, name) => `${dim}: ${name}`,
			search: 'Search employee, code, amount',
			empty: 'No employees in this group.',
			failed: 'Could not load the employee list.',
			hint: 'Click an employee to open the payroll line in the batch.',
			count: (n) => `${n} employees`,
			cols: {code: 'Code', name: 'Employee', department: 'Department', cur: 'This period', prev: 'Comparison', diff: 'Variance', pct: '%'},
		},
		pnl: {
			title: 'Profit and loss summary',
			sub: 'From the general ledger; "of which labor" rows from payroll',
			search: 'Search line, amount',
			cols: {item: 'Line', cur: 'This period', prev: 'Comparison', diff: 'Variance', pct: '%', ofRevenue: '% of revenue'},
			rows: {revenue: 'Revenue', cogs: 'Cost of goods sold', laborCogs: 'of which labor', grossProfit: 'Gross profit', opex: 'Operating expenses', laborOpex: 'of which labor', operatingProfit: 'Profit (per GL)'},
			searchAs: {laborCogs: 'labor in cost of goods sold', laborOpex: 'labor in operating expenses'},
		},
		recon: {
			title: 'General ledger reconciliation',
			sub: 'Payroll amounts against general ledger activity for each expense account',
			ok: 'Matched',
			off: 'Mismatch',
			okText: (n) => `${n} labor expense accounts match the general ledger.`,
			offText: (n, amount) => `${n} accounts differ, total difference ${amount}.`,
			show: 'Show details',
			hide: 'Collapse',
			search: 'Search account, amount',
			empty: 'No labor expense accounts this month.',
			noGl: 'Your role cannot read the general ledger, so nothing can be reconciled.',
			name: 'Account name',
			cols: {account: 'Account', payroll: 'Per payroll', gl: 'Per general ledger', difference: 'Difference', status: 'Result'},
		},
	},
};

const DIMS = ['department', 'project', 'class', 'location', 'account', 'component', 'employmentType'];
const COMPONENTS = ['wages', 'overtime', 'allowance', 'bonus', 'piecework', 'other', 'employerIns', 'accrued13', 'contractor'];
const BRIDGE_STEPS = ['headcount', 'wages', 'overtime', 'allowance', 'bonus', 'piecework', 'other', 'employerIns', 'accrued13', 'contractor'];
const PNL_KEYS = ['revenue', 'cogs', 'laborCogs', 'grossProfit', 'opex', 'laborOpex', 'operatingProfit'];
const INK = '#1D2730';

// ------------------------------------------------------------------ số và tháng

const isNum = (v) => typeof v === 'number' && isFinite(v);
const numOr = (v) => (isNum(v) ? v : v === null || v === undefined || v === '' || typeof v === 'object' || isNaN(Number(v)) ? null : Number(v));
const loc = (v, digits) => Number(v).toLocaleString('vi-VN', {maximumFractionDigits: digits, minimumFractionDigits: 0});
const DASH = '-';
const cash = (v) => (isNum(v) ? money(v) : DASH);
const pct1 = (v) => (isNum(v) ? `${loc(v * 100, 1)}%` : DASH);
const signed = (v, s) => (v > 0 ? `+${s}` : v < 0 ? `-${s}` : s);
const signedPct = (v) => (isNum(v) ? signed(v, `${loc(Math.abs(v) * 100, 1)}%`) : '');
const ratio = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

// Số tiền rút gọn cho nhãn biểu đồ và chú thích (1,28 tỷ; 86,2 tr); số đầy đủ nằm ở bảng và ở title
function compact(v, unit) {
	if (!isNum(v)) return DASH;
	const a = Math.abs(v);
	const s = a >= 1e9 ? `${loc(a / 1e9, 2)} ${unit.bn}` : a >= 1e6 ? `${loc(a / 1e6, 1)} ${unit.mn}` : a >= 1e4 ? `${loc(a / 1e3, 0)} ${unit.th}` : loc(a, 0);
	return v < 0 ? `-${s}` : s;
}
const signedCompact = (v, unit) => (isNum(v) ? signed(v, compact(Math.abs(v), unit)) : '');

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
// Tháng người dùng gõ: 2026-10, 202610 hoặc 10/2026 -> '2026-10'; chưa đủ thì ''
function parseMonth(v) {
	const s = String(v === null || v === undefined ? '' : v).trim();
	if (MONTH.test(s)) return s;
	let m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(s);
	if (m) return `${m[1]}-${m[2]}`;
	m = /^(0?[1-9]|1[0-2])\/(\d{4})$/.exec(s);
	return m ? `${m[2]}-${m[1].padStart(2, '0')}` : '';
}
const monthLabel = (m) => (MONTH.test(String(m || '')) ? `${m.slice(5)}/${m.slice(0, 4)}` : String(m || ''));
const monthShort = (m) => (MONTH.test(String(m || '')) ? `${m.slice(5)}/${m.slice(2, 4)}` : String(m || ''));
function addMonths(m, n) {
	if (!MONTH.test(String(m || ''))) return '';
	const total = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + n;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

// Mốc trên của trục số tiền: số tròn (1, 2, 2,5, 5 x 10^k) vừa đủ chứa giá trị lớn nhất cộng chỗ cho nhãn trên đầu cột
function niceAxis(max) {
	if (!(max > 0)) return {top: 1, ticks: [0]};
	const want = max * 1.14;
	const pow = Math.pow(10, Math.floor(Math.log10(want)));
	const step = [0.1, 0.2, 0.25, 0.5, 1, 2].map((k) => k * pow).find((s) => want / s <= 5) || 2 * pow;
	const top = Math.ceil(want / step - 1e-9) * step;
	const ticks = [];
	for (let v = 0; v <= top + step / 1000; v += step) ticks.push(v);
	return {top, ticks};
}

// Trục số tiền có cả phần âm (tháng có đảo lương): cùng bước chia với phần dương, mốc 0 nằm giữa; không có số âm thì đúng
// bằng niceAxis. Bước được nới đôi khi quá 6 khoảng để nhãn trục không chồng nhau.
function signedAxis(maxPos, maxNeg) {
	const base = niceAxis(Math.max(maxPos, maxNeg));
	if (!(maxNeg > 0)) return {top: base.top, bottom: 0, ticks: base.ticks};
	let step = base.ticks.length > 1 ? base.ticks[1] - base.ticks[0] : base.top;
	const size = (v) => (v > 0 ? Math.ceil((v * 1.14) / step - 1e-9) * step : 0);
	while ((size(maxPos) + size(maxNeg)) / step > 6) step *= 2;
	const top = size(maxPos);
	const bottom = size(maxNeg);
	const ticks = [];
	for (let i = -Math.round(bottom / step); i <= Math.round(top / step); i++) ticks.push(i * step);
	return {top, bottom, ticks};
}

const csvCell = (v) => {
	const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v);
	return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => `﻿${[header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n')}`;

// ------------------------------------------------------------------ biểu đồ xu hướng

// Kích thước (px) phải khớp các lớp s4vp-la-rcell, s4vp-la-rin, s4vp-la-linelayer, s4vp-la-bcell trong ui/css.js
const RATIO_TOP = 16;
const RATIO_H = 42;
const BAR_TOP = 72;
const BAR_H = 132;
const yIn = (f) => 0.04 + 0.92 * f;

function lineImage(points, count) {
	// points: [{i, f}] theo thứ tự tháng; tháng thiếu doanh thu làm đứt đường
	const runs = [];
	let run = [];
	let last = -2;
	points.forEach((p) => {
		if (p.i !== last + 1 && run.length) {
			runs.push(run);
			run = [];
		}
		run.push(`${(p.i + 0.5) * 100},${Math.round((1 - yIn(p.f)) * 1000) / 10}`);
		last = p.i;
	});
	if (run.length) runs.push(run);
	const lines = runs
		.filter((r) => r.length > 1)
		.map((r) => `<polyline points='${r.join(' ')}' fill='none' stroke='${INK}' stroke-width='2' stroke-linejoin='round' stroke-linecap='round' vector-effect='non-scaling-stroke'/>`)
		.join('');
	if (!lines) return '';
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${count * 100} 100' preserveAspectRatio='none'>${lines}</svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function TrendChart({months, selected, compareMonth, noGl, onPick, t}) {
	const rows = (months || []).filter(Boolean).map((m) => {
		// Số âm trong tháng (đảo lương) giữ nguyên dấu: phần âm vẽ xuống dưới trục 0, không cắt về 0
		const cogs = numOr(m.laborCogs) || 0;
		const opex = numOr(m.laborOpex) || 0;
		const labor = numOr(m.labor);
		const revenue = numOr(m.revenue);
		const pos = Math.max(0, cogs) + Math.max(0, opex);
		const neg = Math.max(0, -cogs) + Math.max(0, -opex);
		return {month: String(m.month || ''), cogs, opex, pos, neg, labor: isNum(labor) ? labor : cogs + opex, stack: cogs + opex, rate: !noGl && m.hasGl !== false && revenue > 0 && isNum(labor) ? labor / revenue : null};
	});
	if (!rows.length) return <Empty text={t.trend.empty} />;
	const maxStack = Math.max.apply(null, rows.map((r) => r.stack));
	const axis = signedAxis(Math.max.apply(null, rows.map((r) => r.pos)), Math.max.apply(null, rows.map((r) => r.neg)));
	const span = axis.top + axis.bottom || 1;
	const hasNeg = axis.bottom > 0;
	// Vị trí dọc (px từ đỉnh ô vẽ) của một giá trị trên trục số tiền; phần trăm chiều cao ô cột của một độ lớn
	const yOf = (v) => BAR_TOP + (BAR_H * (axis.top - v)) / span;
	const hOf = (v) => Math.round((v / span) * 1000) / 10;
	const segH = (v, whole) => `${whole > 0 ? Math.round((Math.abs(v) / whole) * 1000) / 10 : 0}%`;
	const rates = rows.filter((r) => isNum(r.rate)).map((r) => r.rate);
	let lo = rates.length ? Math.floor(Math.min.apply(null, rates) * 100 + 1e-9) / 100 : 0;
	let hi = rates.length ? Math.ceil(Math.max.apply(null, rates) * 100 - 1e-9) / 100 : 0;
	if (hi - lo < 0.01) {
		lo = Math.max(0, lo - 0.01);
		hi += 0.01;
	}
	const fOf = (v) => (v - lo) / (hi - lo);
	const points = [];
	rows.forEach((r, i) => isNum(r.rate) && points.push({i, f: fOf(r.rate)}));
	const image = lineImage(points, rows.length);
	// Nhãn số trực tiếp có chọn lọc: tháng đang xem, tháng so sánh và tháng cao nhất; còn lại đọc theo trục, title và bảng
	const labeled = (r) => r.month === selected || r.month === compareMonth || (r.stack === maxStack && maxStack > 0);
	const rateLabeled = (r) => r.month === selected || r.month === compareMonth;
	const px = (v) => `${Math.round(v * 10) / 10}px`;
	return (
		<div class="s4vp-la-chart">
			<div class="s4vp-la-legend">
				<span class="s4vp-la-key">
					<span class="s4vp-la-sw s4vp-la-seg-a" />
					{t.trend.cogs}
				</span>
				<span class="s4vp-la-key">
					<span class="s4vp-la-sw s4vp-la-seg-b" />
					{t.trend.opex}
				</span>
				{rates.length ? (
					<span class="s4vp-la-key">
						<span class="s4vp-la-sw-line" />
						{t.trend.ratio}
					</span>
				) : null}
				<span class="s4vp-la-hint">{t.trend.hint}</span>
			</div>
			{hasNeg ? <div class="s4vp-la-negnote">{t.trend.negative}</div> : null}
			<div class="s4vp-la-trend">
				<div class="s4vp-la-yax" aria-hidden="true">
					{rates.length ? <span style={{top: px(RATIO_TOP + RATIO_H * (1 - yIn(1)) - 6)}}>{pct1(hi)}</span> : null}
					{rates.length ? <span style={{top: px(RATIO_TOP + RATIO_H * (1 - yIn(0)) - 6)}}>{pct1(lo)}</span> : null}
					{axis.ticks.map((v) => (
						<span key={`t${v}`} style={{top: px(yOf(v) - 6)}}>
							{v === 0 ? '0' : compact(v, t.unit)}
						</span>
					))}
				</div>
				<div class="s4vp-la-plot">
					{rates.length ? <div class="s4vp-la-grid" style={{top: px(RATIO_TOP + RATIO_H * (1 - yIn(1)))}} /> : null}
					{rates.length ? <div class="s4vp-la-grid" style={{top: px(RATIO_TOP + RATIO_H * (1 - yIn(0)))}} /> : null}
					{axis.ticks
						.filter((v) => (hasNeg ? v > -axis.bottom : v > 0))
						.map((v) => (
							<div key={`g${v}`} class={hasNeg && v === 0 ? 's4vp-la-grid s4vp-la-zero' : 's4vp-la-grid'} style={{top: px(yOf(v))}} />
						))}
					{image ? <div class="s4vp-la-linelayer" style={{backgroundImage: image}} /> : null}
					<div class="s4vp-la-slots">
						{rows.map((r) => {
							const on = r.month === selected;
							const name = monthLabel(r.month);
							const detail = [`${name} - ${t.trend.total}: ${cash(r.labor)}`, `${t.trend.cogs}: ${cash(r.cogs)}`, `${t.trend.opex}: ${cash(r.opex)}`].concat(isNum(r.rate) ? [`${t.trend.ratio}: ${pct1(r.rate)}`] : []).join('\n');
							const f = isNum(r.rate) ? yIn(fOf(r.rate)) : null;
							// Nhãn tổng đặt trên đầu phần dương (tháng chỉ có số âm: ngay trên trục 0); số là tổng ròng của tháng
							const total = hOf(axis.bottom + r.pos);
							const attrs = {type: 'button', class: on ? 's4vp-la-slot s4vp-on' : 's4vp-la-slot', title: detail, 'aria-label': `${t.trend.pick(name)}. ${detail.replace(/\n/g, '. ')}`, 'aria-pressed': on ? 'true' : 'false'};
							if (!on) attrs.onClick = () => onPick(r.month);
							return (
								<button key={`m${r.month}`} {...attrs}>
									<span class="s4vp-la-rcell">
										{f === null ? null : (
											<span class="s4vp-la-rin">
												<span class="s4vp-la-dot" style={{bottom: `calc(${Math.round(f * 1000) / 10}% - 4px)`}} />
												{rateLabeled(r) ? (
													<span class="s4vp-la-vlab" style={{bottom: `calc(${Math.round(f * 1000) / 10}% + 7px)`}}>
														{pct1(r.rate)}
													</span>
												) : null}
											</span>
										)}
									</span>
									<span class="s4vp-la-bcell">
										<span class="s4vp-la-stack" style={hasNeg ? {bottom: `${hOf(axis.bottom)}%`, height: `${hOf(axis.top)}%`} : {}}>
											{r.cogs > 0 ? <span class={r.opex > 0 ? 's4vp-la-seg s4vp-la-seg-a' : 's4vp-la-seg s4vp-la-seg-a s4vp-la-seg-top'} style={{height: segH(r.cogs, axis.top)}} /> : null}
											{r.opex > 0 ? <span class="s4vp-la-seg s4vp-la-seg-b s4vp-la-seg-top" style={{height: segH(r.opex, axis.top)}} /> : null}
										</span>
										{r.neg > 0 ? (
											<span class="s4vp-la-stack-neg" style={{top: `${hOf(axis.top)}%`, height: `${hOf(axis.bottom)}%`}}>
												{r.cogs < 0 ? <span class={r.opex < 0 ? 's4vp-la-seg s4vp-la-seg-a' : 's4vp-la-seg s4vp-la-seg-a s4vp-la-seg-bot'} style={{height: segH(r.cogs, axis.bottom)}} /> : null}
												{r.opex < 0 ? <span class="s4vp-la-seg s4vp-la-seg-b s4vp-la-seg-bot" style={{height: segH(r.opex, axis.bottom)}} /> : null}
											</span>
										) : null}
										{(labeled(r) || r.neg > 0) && r.stack !== 0 ? (
											<span class="s4vp-la-vlab" style={{bottom: `calc(${total}% + ${r.cogs > 0 && r.opex > 0 ? 5 : 3}px)`}}>
												{compact(r.stack, t.unit)}
											</span>
										) : null}
									</span>
									<span class="s4vp-la-x">{monthShort(r.month)}</span>
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}

// ------------------------------------------------------------------ cầu biến động

// Cầu nằm ngang: mỗi bước một dòng (nhãn - thanh nổi - số). Hai dòng tổng chỉ là vạch mốc, không vẽ thanh từ 0, vì trục
// được thu về vùng biến động để bước nhỏ vẫn đọc được; độ dài mọi thanh tỷ lệ với số tiền của bước.
function BridgeChart({bridge, t}) {
	const byKey = {};
	(Array.isArray(bridge) ? bridge : []).forEach((b) => {
		if (b && b.key) byKey[b.key] = numOr(b.amount);
	});
	if (!isNum(byKey.start) || !isNum(byKey.end)) return <Empty text={t.bridge.none} />;
	const steps = BRIDGE_STEPS.map((key) => ({key, amount: byKey[key] || 0})).filter((s) => Math.round(s.amount) !== 0);
	const explained = steps.reduce((a, s) => a + s.amount, 0);
	const rest = byKey.end - byKey.start - explained;
	if (Math.abs(rest) >= 1) steps.push({key: 'unexplained', amount: rest});
	if (!steps.length) return <Empty text={t.bridge.flat} />;
	let level = byKey.start;
	const rows = [{key: 'start', total: true, from: level, to: level, amount: byKey.start}];
	steps.forEach((s) => {
		rows.push({key: s.key, from: level, to: level + s.amount, amount: s.amount});
		level += s.amount;
	});
	rows.push({key: 'end', total: true, from: byKey.end, to: byKey.end, amount: byKey.end});
	const levels = rows.reduce((a, r) => a.concat([r.from, r.to]), []);
	const lo = Math.min.apply(null, levels);
	const hi = Math.max.apply(null, levels);
	const span = hi - lo || 1;
	const x = (v) => Math.round((2 + ((v - lo) / span) * 96) * 100) / 100;
	return (
		<div class="s4vp-la-chart">
			<div class="s4vp-la-legend">
				<span class="s4vp-la-key">
					<span class="s4vp-la-sw s4vp-la-wf-up" />
					{t.bridge.up}
				</span>
				<span class="s4vp-la-key">
					<span class="s4vp-la-sw s4vp-la-wf-down" />
					{t.bridge.down}
				</span>
				<span class="s4vp-la-key">
					<span class="s4vp-la-sw-mark" />
					{t.bridge.level}
				</span>
			</div>
			<div class="s4vp-la-wf" role="list">
				{rows.map((r, i) => {
					const name = t.bridge.step[r.key] || r.key;
					const value = r.total ? compact(r.amount, t.unit) : signedCompact(r.amount, t.unit);
					const full = r.total ? cash(r.amount) : signed(r.amount, money(Math.abs(r.amount)));
					const last = i === rows.length - 1;
					return (
						<div key={`b${r.key}`} class={r.total ? 's4vp-la-wf-row s4vp-la-wf-total' : 's4vp-la-wf-row'} role="listitem" title={`${name}: ${full}`}>
							<span class="s4vp-la-wf-l">{name}</span>
							<span class="s4vp-la-wf-t">
								{r.total ? <span class="s4vp-la-wf-mark" style={{left: `${x(r.to)}%`}} /> : <span class={r.amount >= 0 ? 's4vp-la-wf-bar s4vp-la-wf-up' : 's4vp-la-wf-bar s4vp-la-wf-down'} style={{left: `${x(Math.min(r.from, r.to))}%`, width: `${Math.round((Math.abs(r.amount) / span) * 9600) / 100}%`}} />}
								{last ? null : <span class="s4vp-la-wf-link" style={{left: `${x(r.to)}%`}} />}
							</span>
							<span class="s4vp-la-wf-v">{value}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ------------------------------------------------------------------ màn hình

export default function LaborAnalyticsView({app}) {
	const t = pick(TEXT);
	const user = (app.boot && app.boot.user) || {};
	const allowed = user.role === 'administrator' || user.isAccountant === true || user.role === 'customrole_s4vp_accountant';
	const subsidiary = app.subsidiary || '';
	const params = (app.route && app.route.params) || {};
	const month = parseMonth(params.month);
	const compare = params.compare === 'yoy' ? 'yoy' : parseMonth(params.compare) || 'prev';
	const mode = compare === 'prev' || compare === 'yoy' ? compare : 'custom';
	const dim = DIMS.indexOf(params.dim) >= 0 ? params.dim : 'department';

	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [tick, setTick] = useState(0);
	const [customOpen, setCustomOpen] = useState(false);
	const [reconOpen, setReconOpen] = useState(false);
	const [drill, setDrill] = useState(null);
	const alive = useRef(true);
	const request = useRef(0);
	const drillRequest = useRef(0);
	// Nút Tải lại: bỏ qua số sổ cái của các tháng đã qua mà máy chủ đang nhớ
	const fresh = useRef(false);

	useEffect(() => {
		alive.current = true;
		if (!allowed || !subsidiary) return undefined;
		request.current += 1;
		const mine = request.current;
		setLoading(true);
		setError('');
		const query = {action: 'laborAnalytics', subsidiary, compare, dim};
		if (month) query.month = month;
		if (fresh.current) query.fresh = '1';
		fresh.current = false;
		call(query).then(
			(r) => {
				if (!alive.current || mine !== request.current) return;
				setData(r && typeof r === 'object' ? r : {});
				setLoading(false);
			},
			(e) => {
				if (!alive.current || mine !== request.current) return;
				setError(errorText(e) || t.loadFailed);
				setLoading(false);
			},
		);
		return () => {
			alive.current = false;
		};
	}, [allowed, subsidiary, month, compare, dim, tick]);

	if (!allowed)
		return (
			<Page>
				<PageHeader title={t.title} />
				<Card>
					<Empty text={t.acctOnly} />
				</Card>
			</Page>
		);
	if (!subsidiary)
		return (
			<Page>
				<PageHeader title={t.title} />
				<Card>
					<Empty text={t.noSubsidiary} />
				</Card>
			</Page>
		);

	const d = data || {};
	const notes = Array.isArray(d.notes) ? d.notes : [];
	const has = (code) => notes.indexOf(code) >= 0;
	const noGl = has('NO_GL_ACCESS');
	const noCompare = has('NO_COMPARE');
	const noFacts = has('NO_FACTS');
	const curMonth = parseMonth(d.month) || month;
	const cmpMonth = parseMonth(d.compare) || (mode === 'custom' ? compare : addMonths(curMonth, mode === 'yoy' ? -12 : -1));
	const months = Array.isArray(d.months) ? d.months.filter(Boolean) : [];
	const curRow = months.find((m) => m.month === curMonth) || {};
	const cmpRow = months.find((m) => m.month === cmpMonth) || null;

	const go = (patch) => {
		const next = Object.assign({month: curMonth, compare, dim}, patch);
		app.go('laborAnalytics', {month: next.month || '', compare: next.compare === 'prev' ? '' : next.compare, dim: next.dim === 'department' ? '' : next.dim});
	};
	const reload = () => {
		fresh.current = true;
		setTick(tick + 1);
	};
	const rebuild = (onlyMonth) =>
		app.confirm(onlyMonth ? t.confirmRebuildMonth(monthLabel(onlyMonth)) : t.confirmRebuildAll, () => {
			const body = {action: 'rebuildLaborFacts', subsidiary};
			if (onlyMonth) body.month = onlyMonth;
			app.run(t.rebuilding, post(body)).then((r) => {
				if (!r || !alive.current) return;
				app.notify(t.rebuilt(numOr(r.done) || 0), 'ok');
				setTick(tick + 1);
			});
		});

	// ---------------------------------------------------------------- bộ chọn ở hàng tiêu đề
	const monthOptions = months
		.map((m) => String(m.month || ''))
		.filter((m) => MONTH.test(m))
		.concat(curMonth && !months.some((m) => m.month === curMonth) ? [curMonth] : [])
		.sort()
		.reverse()
		.map((m) => ({value: m, label: monthLabel(m)}));
	const typeMonth = (v) => {
		const m = parseMonth(v);
		if (m && m !== curMonth) go({month: m});
	};
	const pickCompare = (v) => {
		if (v === 'custom') {
			setCustomOpen(true);
			return;
		}
		setCustomOpen(false);
		go({compare: v === 'yoy' ? 'yoy' : 'prev'});
	};
	const typeCompare = (v) => {
		const m = parseMonth(v);
		if (m && m !== compare) go({compare: m});
	};
	const showCustom = mode === 'custom' || customOpen;
	const actions = [
		<span class="s4vp-la-ctl">
			{t.month}
			<Select value={curMonth} options={monthOptions} onInput={(v) => v && v !== curMonth && go({month: v})} width={112} ariaLabel={t.month} />
			<TextInput value={curMonth} onInput={typeMonth} placeholder="YYYY-MM" width={96} ariaLabel={t.monthType} title={t.monthType} />
		</span>,
		<span class="s4vp-la-ctl">
			{t.compare}
			<Select value={showCustom ? 'custom' : mode} options={['prev', 'yoy', 'custom'].map((k) => ({value: k, label: t.compareOpt[k]}))} onInput={pickCompare} width={178} ariaLabel={t.compare} />
			{showCustom ? <TextInput value={mode === 'custom' ? compare : ''} onInput={typeCompare} placeholder="YYYY-MM" width={96} ariaLabel={t.compareType} title={t.compareType} /> : null}
		</span>,
		<Button label={t.reload} onClick={reload} />,
	];

	// ---------------------------------------------------------------- dữ liệu bảng phân rã (menu xuất CSV dùng)
	const kp = d.kpis && typeof d.kpis === 'object' ? d.kpis : {};
	const kv = (name) => numOr((kp[name] || {}).cur);
	const bd = d.breakdown && typeof d.breakdown === 'object' ? d.breakdown : {};
	const shownDim = DIMS.indexOf(bd.dim) >= 0 ? bd.dim : dim;
	const dimList = Array.isArray(bd.dims) && bd.dims.length ? DIMS.filter((k) => bd.dims.some((x) => (x && typeof x === 'object' ? x.key || x.value : x) === k)) : DIMS;
	const labelOf = (r) => {
		if (shownDim === 'component' && t.comp[r.key]) return t.comp[r.key];
		if (shownDim === 'employmentType' && t.empType[r.key]) return t.empType[r.key];
		if (r.key === '' || r.key === null || r.key === undefined || r.label === null || r.label === undefined || r.label === '') return t.breakdown.unassigned;
		const code = shownDim === 'account' ? r.accountNumber : shownDim === 'project' ? r.code : '';
		return code && String(r.label).indexOf(String(code)) !== 0 ? `${code} ${r.label}` : String(r.label);
	};
	const bdRows = (Array.isArray(bd.rows) ? bd.rows : [])
		.filter(Boolean)
		.map((r, i) => {
			const cur = numOr(r.cur) || 0;
			const prev = noCompare ? null : numOr(r.prev);
			const diff = noCompare ? null : isNum(numOr(r.diff)) ? numOr(r.diff) : isNum(prev) ? cur - prev : null;
			return {id: `${i}:${r.key}`, key: r.key, label: labelOf(r), cur, prev, diff, pct: noCompare ? null : isNum(numOr(r.pct)) ? numOr(r.pct) : ratio(diff, prev), share: numOr(r.share), headcount: numOr(r.headcount), perHead: numOr(r.perHead)};
		})
		.sort((a, b) => Math.abs(b.diff || 0) - Math.abs(a.diff || 0) || b.cur - a.cur);
	const sumOf = (k) => bdRows.reduce((a, r) => a + (r[k] || 0), 0);
	const totalPct = noCompare ? null : ratio(sumOf('diff'), sumOf('prev'));
	// Số người chỉ có nghĩa với chiều phòng ban và loại lao động (máy chủ trả null ở chiều khác): không có thì ẩn hai cột
	const hasHeads = bdRows.some((r) => isNum(r.headcount));
	const bdTotal = {label: t.breakdown.total, cur: sumOf('cur'), prev: noCompare ? null : sumOf('prev'), diff: noCompare ? null : sumOf('diff'), pct: signedPct(totalPct), share: '100%', headcount: kv('headcount'), perHead: kv('costPerHead')};
	const exportBreakdown = () => {
		const c = t.breakdown.cols;
		const head = [t.dims[shownDim], c.cur, c.prev, c.diff, c.pct, c.share].concat(hasHeads ? [c.headcount, c.perHead] : []);
		const line = (r) => [r.label, r.cur, r.prev, r.diff, r.pct, r.share].concat(hasHeads ? [r.headcount, r.perHead] : []);
		download(`labor-${shownDim}-${curMonth || 'month'}.csv`, toCsv(head, bdRows.map(line).concat([line(Object.assign({}, bdTotal, {pct: totalPct, share: 1}))])));
	};
	actions.push(
		<Menu
			label={t.more}
			align="right"
			items={[
				curMonth ? {label: t.rebuildMonth(monthLabel(curMonth)), onClick: () => rebuild(curMonth)} : null,
				{label: t.rebuildAll, onClick: () => rebuild('')},
				{label: t.exportCsv, onClick: exportBreakdown, disabled: !bdRows.length},
			]}
		/>,
	);

	const header = <PageHeader title={t.title} actions={actions} />;

	if (!data)
		return (
			<Page>
				{header}
				<Card tone={error ? 'error' : ''}>
					<Empty text={error || t.loading} />
					{error ? (
						<div class="s4vp-la-center">
							<Button label={t.retry} kind="primary" onClick={reload} />
						</div>
					) : null}
				</Card>
			</Page>
		);

	// ---------------------------------------------------------------- thẻ chỉ số
	const cmpName = monthLabel(cmpMonth);
	const derived = {
		labor: (r) => numOr(r.labor),
		laborToRevenue: (r) => (noGl || r.hasGl === false ? null : ratio(numOr(r.labor), numOr(r.revenue))),
		headcount: (r) => numOr(r.headcount),
		costPerHead: (r) => ratio(numOr(r.labor), numOr(r.headcount)),
		overtimeShare: (r) => ratio(numOr(r.overtime), numOr(r.labor)),
	};
	// Giá trị kỳ so sánh của một chỉ số: `prev` của máy chủ (đã theo kỳ so sánh đang chọn); thiếu thì tính từ dãy 12 tháng nếu có tháng đó
	const kc = (name) => {
		if (noCompare) return null;
		const o = kp[name] || {};
		if (isNum(numOr(o.prev))) return numOr(o.prev);
		return cmpRow && derived[name] ? derived[name](cmpRow) : null;
	};
	const pnlBy = {};
	(Array.isArray(d.pnl) ? d.pnl : []).forEach((r) => {
		if (r && r.key) pnlBy[r.key] = r;
	});
	const pv = (key, side) => (noGl && key !== 'laborCogs' && key !== 'laborOpex' ? null : numOr((pnlBy[key] || {})[side]));
	const vsText = cmpName && !noCompare ? ` ${t.vs(cmpName)}` : '';
	const moneyDelta = (cur, prev) => {
		if (!isNum(cur) || !isNum(prev)) return '';
		const diff = cur - prev;
		const p = ratio(diff, prev);
		return `${signedCompact(diff, t.unit)}${isNum(p) ? ` (${signedPct(p)})` : ''}${vsText}`;
	};
	const pointDelta = (cur, prev) => {
		if (!isNum(cur) || !isNum(prev)) return '';
		const diff = Math.round((cur - prev) * 1000) / 10;
		return diff === 0 ? `${t.kpi.flat}${vsText}` : `${diff > 0 ? t.kpi.worse : t.kpi.better} ${loc(Math.abs(diff), 1)} ${t.points}${vsText}`;
	};
	const labor = isNum(kv('labor')) ? kv('labor') : numOr(curRow.labor);
	const rate = noGl ? null : isNum(kv('laborToRevenue')) ? kv('laborToRevenue') : ratio(labor, numOr(curRow.revenue));
	const rateCmp = noGl ? null : kc('laborToRevenue');
	const rateWorse = isNum(rate) && isNum(rateCmp) && Math.round((rate - rateCmp) * 1000) > 0;
	const laborCogs = isNum(pv('laborCogs', 'cur')) ? pv('laborCogs', 'cur') : numOr(curRow.laborCogs);
	const laborOpex = isNum(pv('laborOpex', 'cur')) ? pv('laborOpex', 'cur') : numOr(curRow.laborOpex);
	const cogs = noGl ? null : isNum(pv('cogs', 'cur')) ? pv('cogs', 'cur') : numOr(curRow.cogs);
	const opex = noGl ? null : isNum(pv('opex', 'cur')) ? pv('opex', 'cur') : numOr(curRow.opex);
	const shareNote = (part, whole, prevPart, prevWhole, text) => {
		if (noGl) return t.noGlShort;
		const now = ratio(part, whole);
		if (!isNum(now)) return '';
		const before = noCompare ? null : ratio(prevPart, prevWhole);
		return `${text(pct1(now))}${isNum(before) ? `, ${t.kpi.was(pct1(before))}` : ''}`;
	};
	const heads = isNum(kv('headcount')) ? kv('headcount') : numOr(curRow.headcount);
	const headsCmp = kc('headcount');
	const perHead = isNum(kv('costPerHead')) ? kv('costPerHead') : ratio(labor, heads);
	const perHeadCmp = kc('costPerHead');
	const perHeadPct = ratio(isNum(perHead) && isNum(perHeadCmp) ? perHead - perHeadCmp : null, perHeadCmp);
	const overtime = isNum(kv('overtimeShare')) ? kv('overtimeShare') : ratio(numOr(curRow.overtime), labor);
	const cards = [
		{key: 'labor', label: t.kpi.labor, value: cash(labor), note: moneyDelta(labor, kc('labor'))},
		{key: 'rate', label: t.kpi.toRevenue, value: pct1(rate), note: noGl ? t.noGlShort : pointDelta(rate, rateCmp), tone: rateWorse ? 'warn' : ''},
		{key: 'cogs', label: t.kpi.inCogs, value: cash(laborCogs), note: shareNote(laborCogs, cogs, pv('laborCogs', 'prev'), pv('cogs', 'prev'), t.kpi.ofCogs)},
		{key: 'opex', label: t.kpi.inOpex, value: cash(laborOpex), note: shareNote(laborOpex, opex, pv('laborOpex', 'prev'), pv('opex', 'prev'), t.kpi.ofOpex)},
		{
			key: 'heads',
			label: t.kpi.headcount,
			value: isNum(heads) ? `${num(heads)}${isNum(headsCmp) && heads !== headsCmp ? ` (${signed(heads - headsCmp, num(Math.abs(heads - headsCmp)))})` : ''}` : DASH,
			note: isNum(perHead) ? `${t.perHeadShort} ${compact(perHead, t.unit)} / ${t.people}${isNum(perHeadPct) ? ` (${signedPct(perHeadPct)})` : ''}` : '',
		},
		{key: 'ot', label: t.kpi.overtime, value: pct1(overtime), note: pointDelta(overtime, kc('overtimeShare'))},
	];

	// ---------------------------------------------------------------- khung chi tiết nhân viên của một nhóm
	const openDrill = (row) => {
		drillRequest.current += 1;
		const mine = drillRequest.current;
		setDrill({row, loading: true, rows: [], error: ''});
		call({action: 'laborDrill', subsidiary, month: curMonth, compare: cmpMonth || compare, dim: shownDim, key: row.key === null || row.key === undefined ? '' : row.key}).then(
			(r) => {
				if (!alive.current || mine !== drillRequest.current) return;
				setDrill({row, loading: false, rows: Array.isArray(r && r.rows) ? r.rows : [], error: ''});
			},
			(e) => {
				if (!alive.current || mine !== drillRequest.current) return;
				setDrill({row, loading: false, rows: [], error: errorText(e) || t.drill.failed});
			},
		);
	};
	const closeDrill = () => {
		drillRequest.current += 1;
		setDrill(null);
	};
	let drillDialog = null;
	if (drill) {
		const rows = drill.rows.filter(Boolean).map((r, i) => {
			const c = r.components && typeof r.components === 'object' ? r.components : {};
			const out = {id: `${i}:${r.employee}`, code: r.code || '', name: r.name || '', department: r.department || '', cur: numOr(r.cur) || 0, prev: noCompare ? null : numOr(r.prev), diff: noCompare ? null : numOr(r.diff), pct: noCompare ? null : numOr(r.pct), batch: r.batch || r.batchId || '', line: r.line || r.lineId || ''};
			COMPONENTS.forEach((k) => {
				out[k] = numOr(c[k]) || 0;
			});
			return out;
		});
		rows.sort((a, b) => Math.abs(b.diff || 0) - Math.abs(a.diff || 0) || b.cur - a.cur);
		const used = COMPONENTS.filter((k) => rows.some((r) => Math.round(r[k]) !== 0));
		const canOpen = rows.some((r) => r.batch);
		const dc = t.drill.cols;
		const cols = [
			{key: 'code', label: dc.code, nowrap: true, width: 78},
			{key: 'name', label: dc.name, nowrap: true},
			shownDim === 'department' ? null : {key: 'department', label: dc.department, nowrap: true},
			{key: 'cur', label: dc.cur, type: 'money', nowrap: true},
			{key: 'prev', label: dc.prev, align: 'right', nowrap: true, render: (r) => cash(r.prev)},
			{key: 'diff', label: dc.diff, align: 'right', nowrap: true, render: (r) => cash(r.diff)},
			{key: 'pct', label: dc.pct, align: 'right', nowrap: true, render: (r) => signedPct(r.pct)},
		]
			.filter(Boolean)
			.concat(used.map((k) => ({key: k, label: t.comp[k], type: 'money', nowrap: true})));
		const total = {name: t.drill.count(rows.length), cur: rows.reduce((a, r) => a + r.cur, 0), prev: noCompare ? '' : cash(rows.reduce((a, r) => a + (r.prev || 0), 0)), diff: noCompare ? '' : cash(rows.reduce((a, r) => a + (r.diff || 0), 0)), pct: ''};
		used.forEach((k) => {
			total[k] = rows.reduce((a, r) => a + r[k], 0);
		});
		const exportDrill = () => download(`labor-${shownDim}-${curMonth}-employees.csv`, toCsv(cols.map((c) => c.label), rows.map((r) => cols.map((c) => r[c.key]))));
		const drillTitle = t.drill.title(t.dims[shownDim], drill.row.label);
		drillDialog = (
			<Dialog title={drillTitle} width={1180} onClose={closeDrill} actions={[<Button label={t.csv} onClick={exportDrill} disabled={!rows.length} />, <Button label={t.close} kind="primary" onClick={closeDrill} />]}>
				{drill.loading ? (
					<Empty text={t.loadingShort} />
				) : drill.error ? (
					<Empty text={drill.error} />
				) : (
					<div class="s4vp-la-drill">
						<Table
							columns={cols}
							rows={rows}
							total={rows.length ? total : null}
							search
							searchPlaceholder={t.drill.search}
							empty={t.drill.empty}
							maxHeight={360}
							label={drillTitle}
							toolbar={<span class="s4vp-small">{`${monthLabel(curMonth)}${vsText}${canOpen ? ` - ${t.drill.hint}` : ''}`}</span>}
							onRowClick={canOpen ? (r) => r.batch && app.go('payrollRun', {id: r.batch, line: r.line}) : null}
						/>
					</div>
				)}
			</Dialog>
		);
	}

	// ---------------------------------------------------------------- bảng phân rã
	const bc = t.breakdown.cols;
	const breakdownCols = [
		{key: 'label', label: t.dims[shownDim] || bc.group, render: (r) => <span class="s4vp-la-name" title={r.label}>{r.label}</span>},
		{key: 'cur', label: bc.cur, type: 'money', nowrap: true},
		{key: 'prev', label: bc.prev, type: 'money', nowrap: true, render: (r) => cash(r.prev)},
		{key: 'diff', label: bc.diff, type: 'money', nowrap: true, render: (r) => cash(r.diff)},
		{key: 'pct', label: bc.pct, align: 'right', nowrap: true, render: (r) => signedPct(r.pct)},
		{
			key: 'share',
			label: bc.share,
			align: 'right',
			nowrap: true,
			render: (r) =>
				isNum(r.share) ? (
					<span class="s4vp-la-share">
						<span class="s4vp-la-share-t">
							<span class="s4vp-la-share-f" style={{width: `${Math.round(Math.max(0, Math.min(1, r.share)) * 1000) / 10}%`}} />
						</span>
						<span class="s4vp-la-share-n">{pct1(r.share)}</span>
					</span>
				) : (
					''
				),
		},
		hasHeads ? {key: 'headcount', label: bc.headcount, type: 'num', nowrap: true} : null,
		hasHeads ? {key: 'perHead', label: bc.perHead, type: 'money', nowrap: true} : null,
	];

	// ---------------------------------------------------------------- lãi lỗ tóm tắt
	const pc = t.pnl.cols;
	const pnlRows = PNL_KEYS.filter((k) => pnlBy[k]).map((k) => {
		const sub = k === 'laborCogs' || k === 'laborOpex';
		const cur = pv(k, 'cur');
		const prev = noCompare ? null : pv(k, 'prev');
		const diff = isNum(cur) && isNum(prev) ? cur - prev : null;
		const given = numOr(pnlBy[k].ofRevenue);
		return {id: k, label: t.pnl.rows[k], searchAs: t.pnl.searchAs[k] || '', sub, strong: k === 'grossProfit' || k === 'operatingProfit', cur, prev, diff, pct: ratio(diff, isNum(prev) ? Math.abs(prev) : null), ofRevenue: noGl ? null : isNum(given) ? given : ratio(cur, pv('revenue', 'cur'))};
	});
	const pnlCols = [
		{key: 'label', label: pc.item, render: (r) => <span class={r.sub ? 's4vp-la-indent' : r.strong ? 's4vp-la-strong' : 's4vp-la-plain'}>{r.label}</span>},
		{key: 'cur', label: pc.cur, align: 'right', nowrap: true, render: (r) => <span class={r.strong ? 's4vp-la-strong' : 's4vp-la-plain'}>{cash(r.cur)}</span>},
		{key: 'prev', label: pc.prev, align: 'right', nowrap: true, render: (r) => cash(r.prev)},
		{key: 'diff', label: pc.diff, align: 'right', nowrap: true, render: (r) => cash(r.diff)},
		{key: 'pct', label: pc.pct, align: 'right', nowrap: true, render: (r) => signedPct(r.pct) || DASH},
		{key: 'ofRevenue', label: pc.ofRevenue, align: 'right', nowrap: true, render: (r) => pct1(r.ofRevenue)},
	];

	const exportPnl = () =>
		download(
			`labor-pnl-${curMonth || 'month'}.csv`,
			toCsv(
				[pc.item, pc.cur, pc.prev, pc.diff, pc.pct, pc.ofRevenue],
				pnlRows.map((r) => [r.sub ? t.pnl.searchAs[r.id] || r.label : r.label, r.cur, r.prev, r.diff, r.pct, r.ofRevenue]),
			),
		);

	// ---------------------------------------------------------------- đối chiếu sổ cái
	const rec = d.reconcile && typeof d.reconcile === 'object' ? d.reconcile : {};
	const recRows = (Array.isArray(rec.rows) ? rec.rows : []).filter(Boolean).map((r, i) => {
		const payroll = numOr(r.payroll) || 0;
		const gl = numOr(r.gl);
		const difference = isNum(numOr(r.difference)) ? numOr(r.difference) : isNum(gl) ? payroll - gl : null;
		const off = isNum(difference) && Math.round(difference) !== 0;
		return {id: `${i}:${r.account}`, accountNumber: r.accountNumber || '', accountName: r.accountName || '', payroll, gl, difference, off, status: off ? t.recon.off : t.recon.ok};
	});
	const offRows = recRows.filter((r) => r.off);
	const recOk = !noGl && (rec.ok === true || (rec.ok === undefined && !offRows.length));
	const recShown = !noGl && (reconOpen || !recOk);
	const rc = t.recon.cols;
	const recCols = [
		{key: 'accountNumber', label: rc.account, render: (r) => <span class="s4vp-la-name s4vp-la-acct" title={`${r.accountNumber} ${r.accountName}`.trim()}>{`${r.accountNumber} ${r.accountName}`.trim()}</span>},
		{key: 'payroll', label: rc.payroll, type: 'money', nowrap: true},
		{key: 'gl', label: rc.gl, type: 'money', nowrap: true, render: (r) => cash(r.gl)},
		{key: 'difference', label: rc.difference, type: 'money', nowrap: true, render: (r) => cash(r.difference)},
		{key: 'status', label: rc.status, nowrap: true, render: (r) => <Badge text={r.status} tone={r.off ? 'warn' : 'ok'} />},
	];
	const recTotal = recRows.length ? {accountNumber: t.breakdown.total, payroll: recRows.reduce((a, r) => a + r.payroll, 0), gl: recRows.reduce((a, r) => a + (r.gl || 0), 0), difference: recRows.reduce((a, r) => a + (r.difference || 0), 0), status: ''} : null;
	const recSummary = noGl ? t.recon.noGl : !recRows.length ? t.recon.empty : recOk ? t.recon.okText(recRows.length) : t.recon.offText(offRows.length, money(offRows.reduce((a, r) => a + Math.abs(r.difference), 0)));
	// CSV gồm mọi tài khoản và dòng tổng, kể cả khi bảng đang thu gọn; vai trò không đọc được sổ cái thì các cột sổ cái trống
	const exportRecon = () => {
		const line = (r) => [r.accountNumber, r.accountName, r.payroll, noGl ? null : r.gl, noGl ? null : r.difference, noGl ? '' : r.status];
		const total = recTotal ? [[recTotal.accountNumber, '', recTotal.payroll, noGl ? null : recTotal.gl, noGl ? null : recTotal.difference, '']] : [];
		download(`labor-reconcile-${curMonth || 'month'}.csv`, toCsv([rc.account, t.recon.name, rc.payroll, rc.gl, rc.difference, rc.status], recRows.map(line).concat(total)));
	};
	const recActions = [
		noGl || !recRows.length ? null : <Badge text={recOk ? t.recon.ok : t.recon.off} tone={recOk ? 'ok' : 'warn'} large />,
		recOk && recRows.length ? <Button label={reconOpen ? t.recon.hide : t.recon.show} small onClick={() => setReconOpen(!reconOpen)} /> : null,
		<Button label={t.csv} small onClick={exportRecon} disabled={!recRows.length} />,
	];

	return (
		<Page>
			{header}
			<div class={loading ? 's4vp-la s4vp-la-stale' : 's4vp-la'}>
				{error ? (
					<div class="s4vp-la-note s4vp-la-note-error" role="alert">
						<span>{error}</span>
						<Button label={t.retry} small onClick={reload} />
					</div>
				) : null}
				{has('FACTS_OUTDATED') && !noFacts ? (
					<div class="s4vp-la-note" role="status">
						<span>{t.outdated}</span>
						<Button label={t.rebuildNow} small onClick={() => rebuild(curMonth)} />
					</div>
				) : null}
				{noFacts ? (
					<Card title={t.noFactsTitle} tone="warn">
						<div>{t.noFacts}</div>
						<div class="s4vp-actions">
							<Button label={t.rebuildNow} kind="primary" onClick={() => rebuild(curMonth)} />
							<Button label={t.goPayroll} onClick={() => app.go('payrollList', {})} />
						</div>
					</Card>
				) : null}
				{noGl && !noFacts ? (
					<div class="s4vp-la-note s4vp-la-note-info" role="status">
						<span>{t.noGl}</span>
					</div>
				) : null}
				{noCompare && !noFacts ? (
					<div class="s4vp-la-note s4vp-la-note-info" role="status">
						<span>{t.noCompare(cmpName)}</span>
					</div>
				) : null}
				{noFacts ? null : <StatCards cards={cards} />}
				{noFacts && !months.length ? null : (
					<div class="s4vp-cols s4vp-la-pair">
						<div class="s4vp-col-main">
							<Card title={t.trend.title}>
								<TrendChart months={months} selected={curMonth} compareMonth={noCompare ? '' : cmpMonth} noGl={noGl} onPick={(m) => go({month: m})} t={t} />
							</Card>
						</div>
						{noFacts ? null : (
							<div class="s4vp-col-side">
								<Card title={noCompare ? t.bridge.title : t.bridge.titleFor(cmpName, monthLabel(curMonth))}>
									{noCompare ? <Empty text={t.bridge.none} /> : <BridgeChart bridge={d.bridge} t={t} />}
								</Card>
							</div>
						)}
					</div>
				)}
				{noFacts ? null : (
					<Card title={t.breakdown.title} sub={t.breakdown.sub} flush>
						<Table
							columns={breakdownCols}
							rows={bdRows}
							total={bdRows.length ? bdTotal : null}
							search
							searchPlaceholder={t.breakdown.search}
							empty={t.breakdown.empty}
							maxHeight={372}
							label={t.breakdown.title}
							toolbar={<Chips items={dimList.map((k) => ({value: k, label: t.dims[k]}))} value={shownDim} onPick={(k) => k !== dim && go({dim: k})} label={t.dimLabel} />}
							onRowClick={openDrill}
							selectedKey={drill ? drill.row.id : ''}
						/>
					</Card>
				)}
				{noFacts ? null : (
					<div class="s4vp-cols s4vp-la-pair">
						<div class="s4vp-col-main">
							<Card title={t.pnl.title} sub={t.pnl.sub} flush actions={[<Button label={t.csv} small onClick={exportPnl} disabled={!pnlRows.length} />]}>
								<Table columns={pnlCols} rows={pnlRows} search searchPlaceholder={t.pnl.search} label={t.pnl.title} />
							</Card>
						</div>
						<div class="s4vp-col-side">
							<Card title={t.recon.title} sub={t.recon.sub} tone={noGl || recOk || !recRows.length ? '' : 'warn'} flush actions={recActions}>
								<div class="s4vp-la-summary">{recSummary}</div>
								{recShown && recRows.length ? <Table columns={recCols} rows={recRows} total={recTotal} search searchPlaceholder={t.recon.search} maxHeight={300} label={t.recon.title} /> : null}
							</Card>
						</div>
					</div>
				)}
			</div>
			{drillDialog}
		</Page>
	);
}
