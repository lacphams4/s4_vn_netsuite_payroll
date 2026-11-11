/**
 * Hoa hồng nhân viên kinh doanh (docs/COMMISSION.md mục 6 và 8, docs/UI_V2.md). Ba tab con:
 * - Bảng tính: chọn tháng, Tính / Duyệt / Mở lại / Hủy theo trạng thái bảng tính; thẻ số liệu; lưới nhân viên (6) + khung chi
 *   tiết (4) với các tab Diễn giải, Giao dịch, Phân đoạn, Điều chỉnh.
 * - Kế hoạch: danh sách kế hoạch, biểu mẫu kế hoạch, lưới thành phần, bậc thang của thành phần đang chọn, phân công, chỉ tiêu
 *   theo tháng; Lưu gửi commissionPlanSave.
 * - Mô phỏng: chọn kế hoạch, nhập doanh số / số lượng / chỉ tiêu -> commissionSimulate (chờ 400 ms sau lần gõ cuối).
 *
 * Quyền (mục 6): xem = administrator, kế toán, HR; ghi = administrator, kế toán.
 * Tên trường của API đọc qua các hàm map* ở đầu file (một chỗ duy nhất), chấp nhận cả camelCase và snake_case.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post, openRecord, errorText, download} from '../lib/api.js';
import {money, num, fmtDate, toNumber, localToday, fold} from '../lib/format.js';
import {pick, localized} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Table, Badge, StatCards, Tabs, Select, SearchSelect, AutoSelect, Field, TextInput, TextArea, NumberInput, MoneyInput, DateInput, MonthInput, Checkbox, Dialog, SidePanel, Empty} from '../ui/kit.js';

// ================================================================== ánh xạ API (mọi tên action, tên trường nằm ở đây)

export const ACTIONS = {
	view: 'commissionView',
	result: 'commissionResult',
	setup: 'commissionSetup',
	simulate: 'commissionSimulate',
	calculate: 'commissionCalculate',
	approve: 'commissionApprove',
	reopen: 'commissionReopen',
	void: 'commissionVoid',
	planSave: 'commissionPlanSave',
	adjust: 'commissionAdjust',
	// Doanh số ngoài (mục 4.1): POST nạp (dryRun = chỉ kiểm), GET liệt kê dòng ngoài của tháng
	importExt: 'commissionImport',
	external: 'commissionExternal',
};
// Số dòng mỗi lượt POST commissionImport (lượt nào API trả more: true thì lib/api.js gửi lại cùng nội dung)
export const IMPORT_CHUNK = 200;
// Cách máy chủ biểu diễn tỷ lệ (core/CommissionEngine.js): mọi tỷ lệ là số phần trăm (105,5 = 105,5%), kể cả % ghi nhận
// của credit (100 = 100%). Đổi ở đây nếu API trả tỷ lệ 0..1.
export const PCT = {attainmentIsRatio: false, creditIsRatio: false};
// Nội dung POST (commissionPlanSave, commissionImport) dùng tên trường của record (snake_case) như api/Commission.js đọc;
// dữ liệu GET đọc được cả camelCase lẫn snake_case qua rd().
// Bộ lọc thành phần gửi máy chủ dạng chuỗi id cách nhau dấu phẩy (đúng kiểu trường text của comm_rule); false = mảng id
export const FILTER_AS_CSV = true;
// Loại thu nhập của kế hoạch lưu theo mã (trường text earning_type); 'id' nếu API dùng id nội bộ
export const EARNING_TYPE_KEY = 'code';

const has = (v) => v !== undefined && v !== null && v !== '';
/** Giá trị đầu tiên có nội dung theo danh sách tên khóa (camelCase rồi snake_case...). */
export function rd(o, ...keys) {
	if (!o || typeof o !== 'object') return undefined;
	for (let i = 0; i < keys.length; i++) if (has(o[keys[i]])) return o[keys[i]];
	return undefined;
}
const str = (v) => (has(v) && typeof v !== 'object' ? String(v) : '');
const numv = (v) => {
	if (!has(v) || typeof v === 'object') return null;
	const n = Number(v);
	return isNaN(n) ? null : n;
};
const bool = (v) => v === true || v === 'T' || v === 't' || v === 1 || v === '1' || v === 'true';
const arr = (v) => (Array.isArray(v) ? v : []);
const countOf = (v) => (Array.isArray(v) ? v.length : numv(v) || 0);
const parseJson = (v) => {
	if (v && typeof v === 'object') return v;
	try {
		return v ? JSON.parse(v) : {};
	} catch (e) {
		return {};
	}
};

/** Danh sách id từ mảng (số, chuỗi, {id} / {value}) hoặc chuỗi "1,2,3"; bỏ trống, bỏ trùng. */
export function idList(v) {
	const raw = Array.isArray(v) ? v : str(v).split(',');
	const out = [];
	raw.forEach((x) => {
		const s = (x && typeof x === 'object' ? str(rd(x, 'id', 'value')) : str(x)).trim();
		if (s && out.indexOf(s) < 0) out.push(s);
	});
	return out;
}

// Mã loại mặt hàng của NetSuite (tl.itemtype) mà bộ lọc thành phần nhận; nhãn ở TEXT.*.cm.itemType
export const ITEM_TYPES = ['InvtPart', 'NonInvtPart', 'Service', 'Assembly', 'Kit', 'OthCharge', 'Discount', 'GiftCert', 'Payment', 'Markup', 'DwnLdItem'];
// Phạm vi khách hàng của thành phần: A tất cả, N chỉ khách mới, E chỉ khách cũ
export const CUSTOMER_SCOPES = ['A', 'N', 'E'];
// Id trường nhóm hàng trên mặt hàng (máy chủ kiểm cùng biểu thức trước khi ghép vào SuiteQL)
export const GROUP_FIELD_RE = /^custitem[a-z0-9_]+$/;

/**
 * Danh sách chữ (mã hàng, nhóm hàng) từ mảng hoặc chuỗi cách nhau dấu phẩy / chấm phẩy / xuống dòng / tab (dán từ Excel):
 * bỏ trống, bỏ trùng không phân biệt hoa thường (giữ cách viết đầu tiên).
 */
export function tokenList(v) {
	const raw = Array.isArray(v) ? v : str(v).split(/[,;\r\n\t]+/);
	const out = [];
	const seen = {};
	raw.forEach((x) => {
		const s = str(x).trim();
		if (!s || seen[s.toUpperCase()]) return;
		seen[s.toUpperCase()] = true;
		out.push(s);
	});
	return out;
}
/** Thêm các mã trong đoạn chữ gõ / dán vào danh sách đang có (không trùng, không phân biệt hoa thường). */
export const addTokens = (list, text) => tokenList(tokenList(list).concat(tokenList(text)));

/** Phạm vi khách hàng của thành phần từ dữ liệu API: f_customer_scope, trống thì theo f_new_customer cũ (T = N). */
export function scopeOf(r) {
	const v = str(rd(r, 'customerScope', 'f_customer_scope', 'fCustomerScope')).toUpperCase();
	if (CUSTOMER_SCOPES.indexOf(v) >= 0) return v;
	return bool(rd(r, 'fNewCustomer', 'f_new_customer', 'newCustomer')) ? 'N' : 'A';
}

// Tháng: ô MonthInput dùng 'YYYY-MM', máy chủ dùng số YYYYMM
export const monthInt = (m) => {
	const x = /^(\d{4})-(\d{2})$/.exec(str(m));
	return x ? Number(x[1]) * 100 + Number(x[2]) : null;
};
export const monthIso = (v) => {
	const s = str(v);
	if (/^\d{4}-\d{2}$/.test(s)) return s;
	const x = /^(\d{4})(\d{2})$/.exec(s);
	return x ? `${x[1]}-${x[2]}` : '';
};
export const monthText = (m) => {
	const x = /^(\d{4})-(\d{2})$/.exec(monthIso(m));
	return x ? `${x[2]}/${x[1]}` : str(m);
};
/** Tháng trước của một ngày ISO (mặc định của màn Bảng tính: hoa hồng tính sau khi khóa doanh số tháng trước). */
export function previousMonth(isoDay) {
	const x = /^(\d{4})-(\d{2})/.exec(str(isoDay));
	if (!x) return '';
	let y = Number(x[1]);
	let m = Number(x[2]) - 1;
	if (m < 1) {
		m = 12;
		y -= 1;
	}
	return `${y}-${String(m).padStart(2, '0')}`;
}

const pctOf = (v, isRatio) => {
	const n = numv(v);
	return n === null ? null : isRatio ? n * 100 : n;
};
/** Chữ phần trăm từ số phần trăm (105.5 -> "105,5%"). */
export const pctText = (n) => (n === null || n === undefined || n === '' || isNaN(Number(n)) ? '' : `${Number(n).toLocaleString('vi-VN', {maximumFractionDigits: 2})}%`);

const stepsOf = (v) => arr(v).map((s) => (s && typeof s === 'object' ? {vi: str(s.vi), en: str(s.en)} : {vi: str(s), en: str(s)})).filter((s) => s.vi || s.en);

export function mapRun(r) {
	if (!r || typeof r !== 'object') return null;
	return {
		id: str(rd(r, 'id', 'internalId')),
		name: str(rd(r, 'name', 'code')),
		status: str(rd(r, 'status')).toUpperCase(),
		from: str(rd(r, 'from', 'dateFrom', 'date_from')),
		to: str(rd(r, 'to', 'dateTo', 'date_to')),
		totalBase: numv(rd(r, 'totalBase', 'total_base')),
		totalAmount: numv(rd(r, 'totalAmount', 'total_amount')),
		employees: numv(rd(r, 'employees')),
		batch: str(rd(r, 'batch')),
		batchName: str(rd(r, 'batchName', 'batchNbr', 'batchText')),
		calcAt: str(rd(r, 'calcAt', 'calc_at')),
		approvedByName: str(rd(r, 'approvedByName', 'approved_by_name')),
		note: str(rd(r, 'note')),
		warnings: arr(rd(r, 'warnings')).map((w) => (w && typeof w === 'object' ? {code: str(w.code), vi: str(w.vi), en: str(w.en)} : {code: '', vi: str(w), en: str(w)})),
	};
}

export function mapRow(r, i) {
	const resultId = str(rd(r, 'resultId', 'result', 'id'));
	return {
		id: resultId || `r${i}`,
		resultId,
		employee: str(rd(r, 'employee', 'employeeId')),
		code: str(rd(r, 'code', 'employeeCode', 'entityId')),
		name: str(rd(r, 'name', 'employeeName')),
		department: str(rd(r, 'departmentName', 'department')),
		plan: str(rd(r, 'plan', 'planId')),
		planName: str(rd(r, 'planName', 'planCode')),
		quota: numv(rd(r, 'quota')),
		base: numv(rd(r, 'base')),
		attainment: pctOf(rd(r, 'attainment'), PCT.attainmentIsRatio),
		earned: numv(rd(r, 'earned')),
		override: numv(rd(r, 'override', 'overrideAmount', 'override_amount')),
		adjustments: numv(rd(r, 'adjustments', 'adjustmentAmount')),
		capped: numv(rd(r, 'capped')),
		drawPaid: numv(rd(r, 'drawPaid', 'draw_paid')),
		payable: numv(rd(r, 'payable')),
		warnings: countOf(rd(r, 'warnings', 'warningCount')),
	};
}

/** commissionView -> {run, rows, kpis, months}; thẻ số liệu tự tính từ dòng khi API không trả kpis. */
export function mapView(raw) {
	const v = raw || {};
	const run = mapRun(v.run);
	const rows = arr(v.rows).map(mapRow);
	const k = v.kpis || {};
	const sum = (key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
	const withAtt = rows.filter((r) => r.attainment !== null);
	const people = rows.map((r) => r.employee || r.code).filter((x, i, a) => x && a.indexOf(x) === i).length;
	const kAtt = rd(k, 'avgAttainment', 'averageAttainment', 'attainment');
	const kpis = {
		totalBase: numv(rd(k, 'totalBase', 'base')) !== null ? numv(rd(k, 'totalBase', 'base')) : run && run.totalBase !== null ? run.totalBase : sum('base'),
		totalAmount: numv(rd(k, 'totalAmount', 'totalPayable', 'payable')) !== null ? numv(rd(k, 'totalAmount', 'totalPayable', 'payable')) : run && run.totalAmount !== null ? run.totalAmount : sum('payable'),
		employees: numv(rd(k, 'employees')) !== null ? numv(rd(k, 'employees')) : run && run.employees !== null ? run.employees : people,
		avgAttainment: has(kAtt) ? pctOf(kAtt, PCT.attainmentIsRatio) : withAtt.length ? withAtt.reduce((s, r) => s + r.attainment, 0) / withAtt.length : null,
		warnings: numv(rd(k, 'warnings')) !== null ? numv(rd(k, 'warnings')) : sum('warnings'),
	};
	const months = arr(v.months).map(monthIso).filter(Boolean);
	return {run, rows, kpis, months};
}

const mapComponent = (c, i) => ({
	key: `c${i}`,
	rule: str(rd(c, 'rule', 'id')),
	name: str(rd(c, 'name')),
	method: str(rd(c, 'method')).toUpperCase(),
	base: numv(rd(c, 'base')),
	amount: numv(rd(c, 'amount')),
	steps: stepsOf(c && c.steps),
});
const mapCredit = (c, i) => ({
	id: `t${i}`,
	tranId: str(rd(c, 'tranId', 'transaction')),
	tranNo: str(rd(c, 'tranNo', 'tranid', 'docNo')),
	tranType: str(rd(c, 'tranType', 'type')).toUpperCase(),
	date: str(rd(c, 'date', 'trandate')),
	customer: str(rd(c, 'customerName', 'customerText', 'customer')),
	item: str(rd(c, 'itemName', 'itemCode', 'itemText', 'item')),
	pct: pctOf(rd(c, 'pct', 'contribution'), PCT.creditIsRatio),
	// Nguồn của credit: trống / N / NS = NetSuite, còn lại là tên hệ thống ngoài (DMS, POS...)
	source: str(rd(c, 'sourceSystem', 'source_system', 'source')),
	base: numv(rd(c, 'base')),
	qty: numv(rd(c, 'qty', 'quantity')),
	revenue: numv(rd(c, 'revenue')),
});
const mapShare = (s, i) => ({
	id: `s${i}`,
	department: str(rd(s, 'departmentName', 'department', 'subName', 'sub')),
	cls: str(rd(s, 'className', 'classText', 'workCenterName', 'workCenter', 'classId')),
	location: str(rd(s, 'locationName', 'location', 'branchName', 'branch')),
	project: str(rd(s, 'projectName', 'project', 'jobName', 'job')),
	amount: numv(rd(s, 'amount')),
});
const mapAdjust = (a, i) => ({
	id: str(rd(a, 'id')) || `a${i}`,
	plan: str(rd(a, 'plan')),
	planName: str(rd(a, 'planName')),
	amount: numv(rd(a, 'amount')),
	reason: str(rd(a, 'reason')),
	date: str(rd(a, 'date', 'created', 'createdAt')),
	by: str(rd(a, 'createdByName', 'byName', 'owner')),
});

/** commissionResult -> số liệu đủ của một kết quả + diễn giải (detail có thể là chuỗi JSON hoặc đối tượng). */
export function mapResult(raw) {
	const r = (raw && (raw.result || raw)) || {};
	const d = parseJson(r.detail);
	const pickList = (...keys) => {
		for (let i = 0; i < keys.length; i++) {
			const v = Array.isArray(r[keys[i]]) ? r[keys[i]] : Array.isArray(d[keys[i]]) ? d[keys[i]] : null;
			if (v) return v;
		}
		return [];
	};
	return {
		id: str(rd(r, 'id', 'resultId')),
		employee: str(rd(r, 'employee')),
		plan: str(rd(r, 'plan')),
		planName: str(rd(r, 'planName')),
		basis: str(rd(r, 'basis') || rd(d, 'basis')).toUpperCase(),
		earningType: str(rd(r, 'earningType', 'earning_type')),
		quota: numv(rd(r, 'quota')),
		base: numv(rd(r, 'base')),
		windowBase: numv(rd(r, 'windowBase', 'window_base')),
		attainment: pctOf(rd(r, 'attainment'), PCT.attainmentIsRatio),
		gross: numv(rd(r, 'gross')),
		priorPaid: numv(rd(r, 'priorPaid', 'prior_paid')),
		earned: numv(rd(r, 'earned')),
		override: numv(rd(r, 'override', 'overrideAmount', 'override_amount')),
		adjustments: numv(rd(r, 'adjustments', 'adjustmentAmount')),
		capped: numv(rd(r, 'capped')),
		drawPaid: numv(rd(r, 'drawPaid', 'draw_paid')),
		drawRecovered: numv(rd(r, 'drawRecovered', 'draw_recovered')),
		drawBalance: numv(rd(r, 'drawBalance', 'draw_balance')),
		payable: numv(rd(r, 'payable')),
		components: pickList('components').map(mapComponent),
		steps: stepsOf(pickList('steps')),
		credits: pickList('credits').map(mapCredit),
		shares: pickList('shares').map(mapShare),
		warnings: pickList('warnings').map((w) => (w && typeof w === 'object' ? {code: str(w.code), vi: str(w.vi), en: str(w.en)} : {code: '', vi: str(w), en: str(w)})),
		adjustList: pickList('adjustmentList', 'adjustList', 'adjusts', 'adjustmentLines').map(mapAdjust),
	};
}

const optionsOf = (v) =>
	arr(v)
		.map((o) => {
			if (!o || typeof o !== 'object') return {value: str(o), label: str(o)};
			const value = str(rd(o, 'id', 'value'));
			const code = str(rd(o, 'code', 'entityId', 'number'));
			const name = str(rd(o, 'name', 'label', 'text'));
			return {value, label: code && name && code !== name ? `${code} ${name}` : name || code || value};
		})
		.filter((o) => o.value);

const DEFAULT_EXCLUDE = 'TaxItem,ShipItem,Subtotal,Description,EndGroup,Group';
let keySeq = 0;
const newKey = (p) => {
	keySeq += 1;
	return `${p}${keySeq}`;
};
const s = (v) => (has(v) ? String(v) : '');

const mapTier = (x) => ({key: has(rd(x, 'id')) ? `t:${x.id}` : newKey('nt'), id: str(rd(x, 'id')), fromValue: s(rd(x, 'fromValue', 'from_value', 'from')), rate: s(rd(x, 'rate')), amount: rd(x, 'amount') === undefined ? '' : numv(rd(x, 'amount'))});
const mapRule = (r, i) => ({
	key: has(rd(r, 'id')) ? `r:${r.id}` : newKey('nr'),
	id: str(rd(r, 'id')),
	sequence: s(rd(r, 'sequence')) || String((i + 1) * 10),
	name: str(rd(r, 'name')),
	method: str(rd(r, 'method')).toUpperCase() || 'P',
	rate: s(rd(r, 'rate')),
	unitAmount: rd(r, 'unitAmount', 'unit_amount') === undefined ? '' : numv(rd(r, 'unitAmount', 'unit_amount')),
	fItems: idList(rd(r, 'fItems', 'f_items', 'items')),
	fClasses: idList(rd(r, 'fClasses', 'f_classes', 'classes')),
	fDepartments: idList(rd(r, 'fDepartments', 'f_departments', 'departments')),
	fLocations: idList(rd(r, 'fLocations', 'f_locations', 'locations')),
	fCustCategories: idList(rd(r, 'fCustCategories', 'f_cust_categories', 'customerCategories')),
	// Loại mặt hàng giữ đúng mã NetSuite (InvtPart...) dù API trả chữ thường
	fItemTypes: idList(rd(r, 'fItemTypes', 'f_item_types')).map((x) => ITEM_TYPES.find((c) => c.toUpperCase() === x.toUpperCase()) || x),
	fItemCodes: tokenList(rd(r, 'fItemCodes', 'f_item_codes')),
	fItemGroups: tokenList(rd(r, 'fItemGroups', 'f_item_groups')),
	customerScope: scopeOf(r),
	newDays: s(rd(r, 'newDays', 'new_days')) || '90',
	tiers: arr(r && r.tiers).map(mapTier),
});
const mapAssign = (a) => ({
	key: has(rd(a, 'id')) ? `a:${a.id}` : newKey('na'),
	id: str(rd(a, 'id')),
	employee: str(rd(a, 'employee')),
	effective: str(rd(a, 'effective')),
	expiration: str(rd(a, 'expiration')),
	quota: rd(a, 'quota') === undefined ? '' : numv(rd(a, 'quota')),
	manager: str(rd(a, 'manager')),
});
const mapQuota = (q) => ({key: has(rd(q, 'id')) ? `q:${q.id}` : newKey('nq'), id: str(rd(q, 'id')), employee: str(rd(q, 'employee')), month: monthIso(rd(q, 'month')), quota: rd(q, 'quota') === undefined ? '' : numv(rd(q, 'quota'))});

/** Một kế hoạch của commissionSetup -> bản nháp của biểu mẫu (số giữ dạng chuỗi / số để đưa thẳng vào ô nhập). */
export function mapPlan(p) {
	const x = p || {};
	const ratesFirst = (keys) => s(rd(x, ...keys));
	return {
		key: has(rd(x, 'id')) ? `p:${x.id}` : newKey('np'),
		id: str(rd(x, 'id')),
		name: str(rd(x, 'name', 'code')),
		description: str(rd(x, 'description')),
		subsidiary: str(rd(x, 'subsidiary')),
		effective: str(rd(x, 'effective')),
		expiration: str(rd(x, 'expiration')),
		source: str(rd(x, 'source', 'salesSource', 'sales_source')).toUpperCase() || 'N',
		basis: str(rd(x, 'basis')).toUpperCase() || 'R',
		trigger: str(rd(x, 'trigger')).toUpperCase() || 'I',
		creditSource: str(rd(x, 'creditSource', 'credit_source')).toUpperCase() || 'R',
		creditField: str(rd(x, 'creditField', 'credit_field')),
		window: str(rd(x, 'window')).toUpperCase() || 'M',
		includeReturns: rd(x, 'includeReturns', 'include_returns') === undefined ? true : bool(rd(x, 'includeReturns', 'include_returns')),
		clawbackDays: ratesFirst(['clawbackDays', 'clawback_days']) || '0',
		excludeItemTypes: rd(x, 'excludeItemTypes', 'exclude_item_types') === undefined ? DEFAULT_EXCLUDE : str(rd(x, 'excludeItemTypes', 'exclude_item_types')),
		earningType: str(rd(x, 'earningType', 'earning_type')),
		minAttainment: ratesFirst(['minAttainment', 'min_attainment']),
		capAmount: rd(x, 'capAmount', 'cap_amount') === undefined ? '' : numv(rd(x, 'capAmount', 'cap_amount')),
		drawType: str(rd(x, 'drawType', 'draw_type')).toUpperCase() || 'N',
		drawAmount: rd(x, 'drawAmount', 'draw_amount') === undefined ? '' : numv(rd(x, 'drawAmount', 'draw_amount')),
		overridePct: ratesFirst(['overridePct', 'override_pct']),
		overrideBasis: str(rd(x, 'overrideBasis', 'override_basis')).toUpperCase() || 'B',
		itemGroupField: str(rd(x, 'itemGroupField', 'item_group_field')),
		inactive: bool(rd(x, 'isInactive', 'isinactive', 'inactive')),
		rules: arr(x.rules).map(mapRule),
		assignments: arr(x.assignments).map(mapAssign),
		quotas: arr(x.quotas).map(mapQuota),
	};
}

/** commissionSetup -> {plans, earningTypes, lookups} với lookups là danh sách [{value, label}]. */
export function mapSetup(raw) {
	const v = raw || {};
	const lk = v.lookups || {};
	return {
		plans: arr(v.plans).map(mapPlan),
		earningTypes: arr(v.earningTypes)
			.map((e) => {
				const code = str(rd(e, 'code'));
				const id = str(rd(e, 'id'));
				const value = EARNING_TYPE_KEY === 'id' ? id : code || id;
				return {value, label: [code, str(rd(e, 'name'))].filter(Boolean).join(' - ') || value};
			})
			.filter((o) => o.value),
		lookups: {
			classes: optionsOf(lk.classes),
			departments: optionsOf(lk.departments),
			locations: optionsOf(lk.locations),
			customerCategories: optionsOf(lk.customerCategories || lk.custCategories),
			employees: optionsOf(lk.employees || lk.salesReps),
			items: optionsOf(lk.items),
		},
	};
}

/** Bản nháp kế hoạch mới với mặc định hợp lý. */
export function newPlanDraft(subsidiary, today) {
	const d = mapPlan({});
	d.subsidiary = str(subsidiary);
	const x = /^(\d{4})-(\d{2})/.exec(str(today));
	d.effective = x ? `${x[1]}-${x[2]}-01` : '';
	d.rules = [newRule(1)];
	return d;
}
export const newRule = (n) => Object.assign(mapRule({}, 0), {sequence: String((n || 1) * 10), method: 'P'});

export const TIER_METHODS = ['G', 'S', 'A', 'B'];
const tierFromIsPct = (m) => m === 'A' || m === 'B';

/** Kiểm biểu mẫu kế hoạch; trả {plan: {trường: mã}, rules: {key: mã}, assignments: {key: mã}, quotas: {key: mã}, count}. Mã lỗi đổi thành chữ ở view. */
export function validatePlan(d) {
	const out = {plan: {}, rules: {}, assignments: {}, quotas: {}, count: 0};
	const bad = (group, key, code) => {
		if (!out[group][key]) out.count += 1;
		out[group][key] = code;
	};
	if (!str(d.name).trim()) bad('plan', 'name', 'required');
	if (!str(d.earningType)) bad('plan', 'earningType', 'required');
	if (d.effective && d.expiration && d.expiration < d.effective) bad('plan', 'expiration', 'dateOrder');
	if (d.creditSource === 'F' && !str(d.creditField).trim()) bad('plan', 'creditField', 'required');
	if (d.drawType && d.drawType !== 'N' && !(toNumber(d.drawAmount) > 0)) bad('plan', 'drawAmount', 'positive');
	const groupField = str(d.itemGroupField).trim().toLowerCase();
	if (groupField && !GROUP_FIELD_RE.test(groupField)) bad('plan', 'itemGroupField', 'groupField');
	if (!arr(d.rules).length) bad('plan', 'rules', 'noRules');
	arr(d.rules).forEach((r) => {
		const scoped = r.customerScope === 'N' || r.customerScope === 'E';
		const days = toNumber(r.newDays);
		if (!str(r.name).trim()) bad('rules', r.key, 'ruleName');
		else if (scoped && (days === null || days < 1 || Math.round(days) !== days)) bad('rules', r.key, 'newDays');
		// Lọc nhóm hàng trên giao dịch NetSuite cần trường nhóm hàng của kế hoạch (nguồn ngoài thì có cột Nhóm hàng)
		else if (tokenList(r.fItemGroups).length && !groupField && (d.source || 'N') === 'N') bad('rules', r.key, 'noGroupField');
		else if (r.method === 'P' && toNumber(r.rate) === null) bad('rules', r.key, 'rate');
		else if (r.method === 'U' && toNumber(r.unitAmount) === null) bad('rules', r.key, 'unit');
		else if (TIER_METHODS.indexOf(r.method) >= 0 && !arr(r.tiers).length) bad('rules', r.key, 'tiers');
		else if (TIER_METHODS.indexOf(r.method) >= 0 && arr(r.tiers).some((t) => toNumber(t.fromValue) === null || (r.method === 'B' ? toNumber(t.amount) === null : toNumber(t.rate) === null))) bad('rules', r.key, 'tierValues');
	});
	arr(d.assignments).forEach((a) => {
		if (!a.employee) bad('assignments', a.key, 'employee');
		else if (a.effective && a.expiration && a.expiration < a.effective) bad('assignments', a.key, 'dateOrder');
	});
	arr(d.quotas).forEach((q) => {
		if (!q.employee || !monthInt(q.month)) bad('quotas', q.key, 'quotaRow');
		else if (toNumber(q.quota) === null) bad('quotas', q.key, 'quotaRow');
	});
	return out;
}

/** Bản nháp -> nội dung POST commissionPlanSave {plan, rules (mỗi thành phần kèm tiers), assignments, quotas}, tên trường snake_case. */
export function planPayload(d, filterAsCsv) {
	const csv = filterAsCsv === undefined ? FILTER_AS_CSV : filterAsCsv;
	const n = (v) => toNumber(v);
	const int = (v) => (n(v) === null ? null : Math.round(n(v)));
	const ids = (a) => (csv ? idList(a).join(',') : idList(a));
	const plan = {
		id: d.id || null,
		name: str(d.name).trim(),
		description: str(d.description).trim(),
		subsidiary: d.subsidiary || null,
		effective: d.effective || null,
		expiration: d.expiration || null,
		source: d.source || 'N',
		basis: d.basis,
		trigger: d.trigger,
		credit_source: d.creditSource,
		credit_field: d.creditSource === 'F' ? str(d.creditField).trim() : '',
		window: d.window,
		include_returns: !!d.includeReturns,
		clawback_days: d.trigger === 'I' ? int(d.clawbackDays) || 0 : 0,
		exclude_item_types: str(d.excludeItemTypes).trim(),
		earning_type: d.earningType || '',
		min_attainment: n(d.minAttainment),
		cap_amount: n(d.capAmount),
		draw_type: d.drawType || 'N',
		draw_amount: d.drawType && d.drawType !== 'N' ? n(d.drawAmount) : null,
		override_pct: n(d.overridePct),
		override_basis: d.overrideBasis || 'B',
		item_group_field: str(d.itemGroupField).trim().toLowerCase(),
	};
	// Bậc thang đi kèm từng thành phần (rules[].tiers); không gửi thêm danh sách tiers phẳng (máy chủ sẽ cộng trùng)
	const rules = arr(d.rules).map((r, i) => {
		const tiers = TIER_METHODS.indexOf(r.method) >= 0
			? arr(r.tiers)
				.map((t) => ({id: t.id || null, from_value: n(t.fromValue), rate: r.method === 'B' ? null : n(t.rate), amount: r.method === 'B' ? n(t.amount) : null}))
				.sort((a, b) => (a.from_value || 0) - (b.from_value || 0))
			: [];
		return {
			key: r.key,
			id: r.id || null,
			sequence: int(r.sequence) === null ? (i + 1) * 10 : int(r.sequence),
			name: str(r.name).trim(),
			method: r.method,
			rate: r.method === 'P' ? n(r.rate) : null,
			unit_amount: r.method === 'U' ? n(r.unitAmount) : null,
			f_items: ids(r.fItems),
			f_classes: ids(r.fClasses),
			f_departments: ids(r.fDepartments),
			f_locations: ids(r.fLocations),
			f_cust_categories: ids(r.fCustCategories),
			// Bộ lọc chữ luôn gửi dạng chuỗi cách nhau dấu phẩy (trường text / textarea của comm_rule)
			f_item_types: idList(r.fItemTypes).join(','),
			f_item_codes: tokenList(r.fItemCodes).join(','),
			f_item_groups: tokenList(r.fItemGroups).join(','),
			f_customer_scope: r.customerScope || 'A',
			// f_new_customer cũ giữ đồng bộ cho bản đọc cũ
			f_new_customer: r.customerScope === 'N',
			new_days: r.customerScope === 'N' || r.customerScope === 'E' ? int(r.newDays) || 90 : null,
			tiers,
		};
	});
	const assignments = arr(d.assignments).map((a) => ({id: a.id || null, employee: a.employee, effective: a.effective || null, expiration: a.expiration || null, quota: n(a.quota), manager: a.manager || null}));
	const quotas = arr(d.quotas).map((q) => ({id: q.id || null, employee: q.employee, month: monthInt(q.month), quota: n(q.quota)}));
	return {plan, rules, assignments, quotas};
}

// ------------------------------------------------------------------ doanh số ngoài (docs/COMMISSION.md mục 4.1)

/**
 * Trường của dòng doanh số ngoài và các tên tiêu đề tự nhận (so sau khi bỏ dấu, chữ thường, "_" / "-" thành dấu cách).
 * Thứ tự tên quan trọng: khớp đúng cả tên trước, rồi mới khớp phần đầu.
 */
export const IMPORT_FIELDS = [
	{key: 'docNo', required: true, names: ['so chung tu', 'so ct', 'so hoa don', 'so phieu', 'doc no', 'document no', 'document', 'invoice no', 'doc']},
	{key: 'lineNo', names: ['dong', 'so dong', 'line no', 'line']},
	{key: 'tranType', names: ['loai', 'loai chung tu', 'tran type', 'type']},
	{key: 'date', required: true, names: ['ngay', 'ngay chung tu', 'ngay hoa don', 'date', 'tran date', 'trandate']},
	{key: 'customerCode', names: ['ma kh', 'ma khach hang', 'ma khach', 'customer code', 'customer id']},
	{key: 'customerName', names: ['ten kh', 'ten khach hang', 'khach hang', 'customer name', 'customer']},
	{key: 'customerCategory', names: ['nhom kh', 'nhom khach hang', 'customer category', 'category']},
	{key: 'itemCode', names: ['ma hang', 'ma mat hang', 'mat hang', 'item code', 'item', 'sku']},
	{key: 'itemType', names: ['loai hang', 'loai mat hang', 'item type', 'itemtype']},
	{key: 'itemGroup', names: ['nhom hang', 'nhom mat hang', 'item group', 'product group']},
	{key: 'customerType', names: ['loai kh', 'loai khach hang', 'loai khach', 'khach moi cu', 'customer type', 'new customer']},
	{key: 'revenue', names: ['doanh thu', 'thanh tien', 'revenue', 'net amount', 'amount']},
	{key: 'cost', names: ['gia von', 'cost']},
	{key: 'qty', names: ['so luong', 'sl', 'qty', 'quantity']},
	{key: 'employee', required: true, names: ['ma nv', 'ma nhan vien', 'nhan vien', 'nv kinh doanh', 'email', 'employee', 'employee code', 'sales rep', 'salesrep']},
	{key: 'department', names: ['phong ban', 'department']},
	{key: 'cls', names: ['class', 'lop']},
	{key: 'location', names: ['dia diem', 'chi nhanh', 'location']},
	{key: 'collectedDate', names: ['ngay thu', 'ngay thu tien', 'collected date', 'payment date']},
	{key: 'collectedAmount', names: ['so da thu', 'da thu', 'so tien thu', 'collected amount', 'collected', 'paid amount']},
];
// Tiêu đề chuẩn của file mẫu (cũng được tự nhận như trên); dòng ví dụ chỉ dùng chữ không dấu. Cột mới thêm ở cuối để file
// mẫu cũ vẫn đúng thứ tự. customer_type: N khách mới, E khách cũ (trống = tính theo ngày mua đầu tiên)
export const TEMPLATE_HEADERS = ['doc_no', 'line_no', 'tran_type', 'date', 'customer_code', 'customer_name', 'customer_category', 'item_code', 'revenue', 'cost', 'qty', 'employee', 'department', 'class', 'location', 'collected_date', 'collected_amount', 'item_type', 'item_group', 'customer_type'];
const TEMPLATE_SAMPLE = ['HD0001', '1', 'I', '2026-10-15', 'KH001', 'Customer A', 'Retail', 'SP001', '15000000', '11000000', '10', 'NV001', '', '', '', '', '', 'InvtPart', 'Dien may', 'N'];
export const templateCsv = () => `﻿${TEMPLATE_HEADERS.join(',')}\r\n${TEMPLATE_SAMPLE.join(',')}\r\n`;

const headKey = (h) =>
	fold(h)
		.replace(/[_\-./]+/g, ' ')
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** Văn bản dán từ Excel (tab) hoặc CSV (dấu phẩy / chấm phẩy, có ngoặc kép) -> {headers, rows, delimiter}; bỏ dòng trống. */
export function parseDelimited(text) {
	const src = String(text === null || text === undefined ? '' : text).replace(/^﻿/, '');
	const first = src.split(/\r?\n/)[0] || '';
	const delimiter = first.indexOf('\t') >= 0 ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
	const rows = [];
	let row = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					cell += '"';
					i += 1;
				} else quoted = false;
			} else cell += ch;
			continue;
		}
		if (ch === '"' && cell === '') quoted = true;
		else if (ch === delimiter) {
			row.push(cell);
			cell = '';
		} else if (ch === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else if (ch !== '\r') cell += ch;
	}
	if (cell !== '' || row.length) {
		row.push(cell);
		rows.push(row);
	}
	const clean = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
	if (!clean.length) return {headers: [], rows: [], delimiter};
	return {headers: clean[0].map((h) => String(h).trim()), rows: clean.slice(1).map((r) => r.map((c) => String(c).trim())), delimiter};
}

/** Tự nhận cột theo tiêu đề: {trường: chỉ số cột dạng chuỗi}; trường không nhận ra thì không có khóa. */
export function guessMapping(headers) {
	const keys = arr(headers).map(headKey);
	const used = [];
	const out = {};
	const passes = [(k, n) => k === n, (k, n) => k.indexOf(`${n} `) === 0];
	passes.forEach((match) => {
		IMPORT_FIELDS.forEach((f) => {
			if (out[f.key] !== undefined) return;
			for (let j = 0; j < f.names.length; j++) {
				const idx = keys.findIndex((k, i) => used.indexOf(i) < 0 && match(k, f.names[j]));
				if (idx >= 0) {
					out[f.key] = String(idx);
					used.push(idx);
					return;
				}
			}
		});
	});
	return out;
}

/** Số trong file: 1.234.567 / 1,234,567.5 / 1.234,5 / (1.000) / -500; trống -> null, không đọc được -> NaN. */
export function parseAmount(raw) {
	const orig = String(raw === null || raw === undefined ? '' : raw).trim();
	if (!orig) return null;
	let s = orig.replace(/[\s ]/g, '').replace(/[^\d.,\-()]/g, '');
	if (!/\d/.test(s)) return NaN;
	let neg = false;
	if (/^\(.*\)$/.test(s)) {
		neg = true;
		s = s.slice(1, -1);
	}
	if (s[0] === '-') {
		neg = !neg;
		s = s.slice(1);
	}
	const dot = s.lastIndexOf('.');
	const comma = s.lastIndexOf(',');
	let norm = s;
	if (dot >= 0 && comma >= 0) {
		const dec = dot > comma ? '.' : ',';
		norm = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
	} else if (comma >= 0) norm = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
	else if (dot >= 0) norm = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
	if (!/^\d+(\.\d+)?$/.test(norm)) return NaN;
	const n = Number(norm);
	return neg ? -n : n;
}

/** Ngày trong file: dd/mm/yyyy, d-m-yyyy, dd.mm.yyyy, yyyy-mm-dd (có giờ phía sau cũng được), số ngày kiểu Excel -> ISO; trống -> null, sai -> ''. */
export function parseDay(raw) {
	const s = String(raw === null || raw === undefined ? '' : raw).trim();
	if (!s) return null;
	let y;
	let mo;
	let d;
	let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
	if (m) {
		y = Number(m[1]);
		mo = Number(m[2]);
		d = Number(m[3]);
	} else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s.*)?$/.exec(s))) {
		d = Number(m[1]);
		mo = Number(m[2]);
		y = Number(m[3]);
	} else if (/^\d{5}$/.test(s)) {
		const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
		y = dt.getUTCFullYear();
		mo = dt.getUTCMonth() + 1;
		d = dt.getUTCDate();
	} else return '';
	if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return '';
	return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Loại chứng từ: trống -> I; I / S / C hoặc chữ (hóa đơn, bán lẻ, trả hàng, invoice, cash sale, return...); lạ -> null. */
export function parseTranType(raw) {
	const k = headKey(raw);
	if (!k) return 'I';
	if (['i', 'hd', 'hoa don', 'invoice', 'custinvc', 'ban hang'].indexOf(k) >= 0) return 'I';
	if (['s', 'ban le', 'ban thu tien ngay', 'cash sale', 'cashsale', 'pos'].indexOf(k) >= 0) return 'S';
	if (['c', 'tra hang', 'tra lai', 'hang tra lai', 'return', 'credit memo', 'credit', 'custcred'].indexOf(k) >= 0) return 'C';
	return null;
}

/** Loại khách hàng trong file: N / E hoặc chữ mới / cũ / new / existing; trống -> ''; lạ -> null. */
export function parseCustomerType(raw) {
	const k = headKey(raw);
	if (!k) return '';
	if (['n', 'new', 'moi', 'khach moi'].indexOf(k) >= 0) return 'N';
	if (['e', 'existing', 'old', 'cu', 'khach cu'].indexOf(k) >= 0) return 'E';
	return null;
}

/** Loại mặt hàng trong file: viết lại đúng mã NetSuite khi khớp (invtpart -> InvtPart), khác thì giữ nguyên. */
export const parseItemType = (raw) => {
	const v = str(raw).trim();
	return ITEM_TYPES.find((c) => c.toUpperCase() === v.toUpperCase()) || v;
};

/**
 * Bảng đã đọc + ánh xạ cột -> dòng chuẩn {row, docNo, lineNo, tranType, date, ..., errors: [mã]}. Dòng thiếu số dòng được đánh số
 * theo thứ tự trong cùng chứng từ (khóa chống trùng ổn định khi nạp lại cùng file). Mã lỗi: noDoc, badType, badDate, noEmployee,
 * badNumber, noAmount, duplicate, badCustType.
 */
export function buildImportRows(table, mapping) {
	const map = mapping || {};
	const col = (r, k) => {
		const i = map[k];
		return i === '' || i === undefined || i === null ? '' : str(r[Number(i)]).trim();
	};
	const lineSeq = {};
	const seen = {};
	return arr(table && table.rows).map((r, i) => {
		const errors = [];
		const add = (c) => errors.indexOf(c) < 0 && errors.push(c);
		const docNo = col(r, 'docNo');
		if (!docNo) add('noDoc');
		let lineNo = col(r, 'lineNo');
		lineSeq[docNo] = (lineSeq[docNo] || 0) + 1;
		if (!lineNo) lineNo = String(lineSeq[docNo]);
		const tranType = parseTranType(col(r, 'tranType'));
		if (tranType === null) add('badType');
		const date = parseDay(col(r, 'date'));
		if (!date) add('badDate');
		const employee = col(r, 'employee');
		if (!employee) add('noEmployee');
		const nums = {};
		['revenue', 'cost', 'qty', 'collectedAmount'].forEach((k) => {
			const v = parseAmount(col(r, k));
			if (v !== null && isNaN(v)) add('badNumber');
			nums[k] = v === null || isNaN(v) ? null : v;
		});
		if (nums.revenue === null && nums.qty === null) add('noAmount');
		const cdRaw = col(r, 'collectedDate');
		const collectedDate = cdRaw ? parseDay(cdRaw) : null;
		if (cdRaw && !collectedDate) add('badDate');
		const ctRaw = col(r, 'customerType');
		const customerType = parseCustomerType(ctRaw);
		if (customerType === null) add('badCustType');
		const key = `${docNo}|${lineNo}`;
		if (docNo && seen[key]) add('duplicate');
		seen[key] = true;
		return {
			row: i + 1,
			docNo,
			lineNo,
			tranType: tranType || col(r, 'tranType'),
			date: date || col(r, 'date'),
			customerCode: col(r, 'customerCode'),
			customerName: col(r, 'customerName'),
			customerCategory: col(r, 'customerCategory'),
			itemCode: col(r, 'itemCode'),
			itemType: parseItemType(col(r, 'itemType')),
			itemGroup: col(r, 'itemGroup'),
			customerType: customerType === null ? ctRaw : customerType,
			revenue: nums.revenue,
			cost: nums.cost,
			qty: nums.qty,
			employee,
			department: col(r, 'department'),
			cls: col(r, 'cls'),
			location: col(r, 'location'),
			collectedDate: collectedDate || cdRaw,
			collectedAmount: nums.collectedAmount,
			errors,
		};
	});
}

/**
 * Một dòng chuẩn -> phần tử `rows` của POST commissionImport (tên trường của record comm_txn). Phòng ban, class, địa điểm
 * phải là id nội bộ (máy chủ báo lỗi dòng nếu không phải).
 */
export const importPayloadRow = (r, importBatch) => ({
	doc_no: r.docNo,
	line_no: r.lineNo,
	tran_type: r.tranType,
	date: r.date,
	customer_code: r.customerCode,
	customer_name: r.customerName,
	customer_category: r.customerCategory,
	item_code: r.itemCode,
	item_type: r.itemType || '',
	item_group: r.itemGroup || '',
	customer_type: r.customerType || '',
	revenue: r.revenue,
	cost: r.cost,
	qty: r.qty,
	employee: r.employee,
	department: r.department,
	class: r.cls,
	location: r.location,
	collected_date: r.collectedDate || null,
	collected_amount: r.collectedAmount,
	import_batch: importBatch || '',
});

const IMPORT_ACTION = {new: 'create', create: 'create', update: 'update', ok: 'same', same: 'same', unchanged: 'same'};
/**
 * Kết quả từng dòng của commissionImport -> {số dòng: {row, status: 'ok'|'error', action: 'create'|'update'|'same'|'', employee, errors}}.
 * `pairs` = [{response, rows}] theo từng lượt gửi: `index` của máy chủ là vị trí (0) trong `rows` của lượt đó.
 */
export function mapImportResults(pairs) {
	const out = {};
	arr(pairs).forEach((p) => {
		const sent = arr(p && p.rows);
		const resp = (p && p.response) || {};
		arr(resp.rows || resp.results).forEach((x) => {
			const idx = numv(rd(x, 'index'));
			const row = idx !== null && sent[idx] ? sent[idx].row : numv(rd(x, 'row'));
			if (row === null) return;
			const errors = arr(rd(x, 'messages', 'errors')).map((e) => (e && typeof e === 'object' ? {code: str(e.code), vi: str(e.vi), en: str(e.en)} : {code: '', vi: str(e), en: str(e)}));
			const status = str(rd(x, 'status')).toLowerCase();
			out[row] = {row, status: errors.length || status === 'error' || status === 'invalid' ? 'error' : 'ok', action: IMPORT_ACTION[status] || '', employeeName: str(rd(x, 'employeeName', 'employeeText')), errors};
		});
	});
	return out;
}

/** Một dòng của GET commissionExternal. */
export const mapExternal = (x, i) => ({
	id: str(rd(x, 'id')) || `x${i}`,
	sourceSystem: str(rd(x, 'sourceSystem', 'source_system')),
	docNo: str(rd(x, 'docNo', 'doc_no')),
	lineNo: str(rd(x, 'lineNo', 'line_no')),
	tranType: str(rd(x, 'tranType', 'tran_type')).toUpperCase(),
	date: str(rd(x, 'date')),
	customer: [str(rd(x, 'customerCode', 'customer_code')), str(rd(x, 'customerName', 'customer_name'))].filter(Boolean).join(' '),
	item: str(rd(x, 'itemCode', 'item_code', 'itemName')),
	employee: [str(rd(x, 'employeeCode', 'code')), str(rd(x, 'employeeName', 'name'))].filter(Boolean).join(' ') || str(rd(x, 'employee')),
	revenue: numv(rd(x, 'revenue')),
	cost: numv(rd(x, 'cost')),
	qty: numv(rd(x, 'qty', 'quantity')),
	collectedAmount: numv(rd(x, 'collectedAmount', 'collected_amount')),
	importBatch: str(rd(x, 'importBatch', 'import_batch')),
	locked: bool(rd(x, 'locked', 'used')),
});

/** Nút trên hàng tiêu đề theo trạng thái bảng tính: {calc, approve, reopen, void} mỗi nút {enabled, reason (mã)}. */
export function runActions(run, canWrite) {
	const st = run ? run.status : '';
	const no = (reason) => ({enabled: false, reason});
	if (!canWrite) return {calc: no('readOnly'), approve: no('readOnly'), reopen: no('readOnly'), void: no('readOnly')};
	if (!run || !run.id) return {calc: {enabled: true, reason: ''}, approve: no('noRun'), reopen: no('noRun'), void: no('noRun')};
	if (st === 'D') return {calc: {enabled: true, reason: ''}, approve: {enabled: true, reason: ''}, reopen: no('notApproved'), void: {enabled: true, reason: ''}};
	if (st === 'A') return {calc: no('approved'), approve: no('approved'), reopen: {enabled: true, reason: ''}, void: no('approved')};
	if (st === 'P') return {calc: no('posted'), approve: no('posted'), reopen: no('posted'), void: no('posted')};
	return {calc: {enabled: true, reason: ''}, approve: no('noRun'), reopen: no('noRun'), void: no('noRun')};
}

/** Quyền theo bootstrap: xem = administrator, kế toán, HR; ghi = administrator, kế toán (docs/COMMISSION.md mục 6). */
export function rolesOf(user) {
	const u = user || {};
	const role = String(u.role || '');
	const admin = role === 'administrator';
	const acct = !!u.isAccountant || role === 'customrole_s4vp_accountant';
	const hr = !!u.isHr || role === 'customrole_s4vp_hr';
	return {canRead: admin || acct || hr, canWrite: admin || acct};
}
export const canSeeCommission = (boot) => rolesOf(boot && boot.user).canRead;

// ================================================================== chữ

const TEXT = {
	vi: {
		cm: {
			title: 'Hoa hồng',
			noSubsidiary: 'Chưa chọn công ty con.',
			noRole: 'Vai trò của bạn không được xem hoa hồng.',
			readOnly: 'Vai trò của bạn chỉ được xem.',
			loading: 'Đang tải...',
			refresh: 'Tải lại',
			tabs: {run: 'Bảng tính', ext: 'Doanh số ngoài', plans: 'Kế hoạch', sim: 'Mô phỏng', label: 'Phần của màn hoa hồng'},
			status: {D: 'Nháp đã tính', A: 'Đã duyệt', P: 'Đã vào bảng lương', none: 'Chưa tính'},
			source: {N: 'Giao dịch NetSuite', X: 'Dữ liệu ngoài đã nạp', B: 'Cả hai'},
			netsuite: 'NetSuite',
			ext: {
				importBtn: 'Nạp doanh số ngoài',
				template: 'Tải file mẫu CSV',
				templateName: 'mau_doanh_so_ngoai.csv',
				sub: (m) => `Dòng doanh số từ hệ thống khác (DMS, POS, sàn...) có ngày chứng từ trong tháng ${m}. Kế hoạch có nguồn "Dữ liệu ngoài" hoặc "Cả hai" sẽ tính trên các dòng này.`,
				search: 'Tìm số chứng từ, khách, mặt hàng, nhân viên, nguồn',
				empty: 'Chưa có doanh số ngoài trong tháng. Bấm Nạp doanh số ngoài để dán từ Excel hoặc chọn file CSV.',
				total: (n) => `Tổng ${n} dòng`,
				locked: 'Đã dùng trong bảng tính đã duyệt',
				cols: {source: 'Nguồn', docNo: 'Số chứng từ', line: 'Dòng', date: 'Ngày', customer: 'Khách', item: 'Mặt hàng', employee: 'Nhân viên', revenue: 'Doanh thu', cost: 'Giá vốn', qty: 'Số lượng', collected: 'Đã thu', batch: 'Lô nạp'},
			},
			imp: {
				title: 'Nạp doanh số ngoài',
				system: 'Hệ thống nguồn',
				systemHint: 'Ví dụ DMS, POS, Shopee',
				paste: 'Dán từ Excel',
				pastePh: 'Chọn vùng trong Excel (kể cả dòng tiêu đề), Ctrl+C rồi dán vào đây',
				file: 'Hoặc chọn file CSV',
				fileHint: 'UTF-8, phân cách dấu phẩy hoặc chấm phẩy, dòng đầu là tiêu đề',
				read: (rows, cols, delim) => `Đã đọc ${rows} dòng, ${cols} cột (phân cách: ${delim}).`,
				delim: {tab: 'Tab', comma: 'dấu phẩy', semi: 'chấm phẩy'},
				noData: 'Chưa có dữ liệu.',
				mapping: 'Ánh xạ cột',
				mappingHint: 'Cột được tự nhận theo tiêu đề; sửa nếu chưa đúng.',
				unused: '(không dùng)',
				fields: {docNo: 'Số chứng từ', lineNo: 'Dòng', tranType: 'Loại (I / S / C)', date: 'Ngày', customerCode: 'Mã KH', customerName: 'Tên KH', customerCategory: 'Nhóm KH', itemCode: 'Mã hàng', itemType: 'Loại hàng (mã NetSuite)', itemGroup: 'Nhóm hàng', customerType: 'Loại KH (N mới / E cũ)', revenue: 'Doanh thu', cost: 'Giá vốn', qty: 'Số lượng', employee: 'Mã NV hoặc email', department: 'Phòng ban (id nội bộ)', cls: 'Class (id nội bộ)', location: 'Địa điểm (id nội bộ)', collectedDate: 'Ngày thu', collectedAmount: 'Số đã thu'},
				missingReq: (names) => `Chưa ánh xạ cột bắt buộc: ${names}.`,
				preview: 'Xem trước',
				search: 'Tìm số chứng từ, nhân viên, lỗi',
				status: {pending: 'Chưa kiểm', ok: 'Hợp lệ', error: 'Lỗi', create: 'Tạo mới', update: 'Cập nhật', same: 'Không đổi'},
				counts: (total, ok, bad) => `${total} dòng - ${ok} hợp lệ - ${bad} lỗi`,
				errors: {noDoc: 'Thiếu số chứng từ', badType: 'Loại không hợp lệ (I, S, C)', badDate: 'Ngày không hợp lệ', noEmployee: 'Thiếu mã nhân viên', badNumber: 'Số không hợp lệ', noAmount: 'Thiếu doanh thu hoặc số lượng', duplicate: 'Trùng số chứng từ + dòng trong file', badCustType: 'Loại KH phải là N (mới) hoặc E (cũ)'},
				cols: {row: 'Dòng', status: 'Trạng thái', docNo: 'Số chứng từ', line: 'Dòng CT', type: 'Loại', date: 'Ngày', customer: 'Khách', item: 'Mặt hàng', revenue: 'Doanh thu', qty: 'Số lượng', employee: 'Nhân viên', errors: 'Lỗi'},
				check: 'Kiểm tra',
				checking: 'Đang kiểm tra dữ liệu...',
				checked: (ok, bad) => (bad ? `Kiểm tra xong: ${ok} dòng hợp lệ, ${bad} dòng lỗi.` : `Kiểm tra xong: ${ok} dòng hợp lệ.`),
				skip: 'Bỏ qua dòng lỗi, chỉ ghi dòng hợp lệ',
				write: (n) => `Ghi ${n} dòng`,
				writing: (n) => `Đang ghi ${n} dòng doanh số ngoài...`,
				confirmSkip: (ok, bad) => `Ghi ${ok} dòng hợp lệ và bỏ qua ${bad} dòng lỗi?`,
				written: (n) => `Đã ghi ${n} dòng doanh số ngoài. Bấm Tính (hoặc Tính lại) ở tab Bảng tính để đưa vào hoa hồng.`,
				needCheck: 'Bấm Kiểm tra trước khi ghi.',
				needFix: 'Còn dòng lỗi: sửa file rồi dán lại, hoặc chọn bỏ qua dòng lỗi.',
				errSystem: 'Nhập tên hệ thống nguồn.',
				close: 'Đóng',
				fileFailed: 'Không đọc được file.',
			},
			basis: {R: 'Doanh thu thuần', G: 'Lãi gộp ước tính', Q: 'Số lượng bán'},
			trigger: {I: 'Khi xuất hóa đơn', P: 'Khi thu tiền'},
			credit: {R: 'NV kinh doanh trên chứng từ', T: 'Đội bán (% đóng góp)', F: 'Trường tùy chỉnh'},
			window: {M: 'Theo tháng', Q: 'Lũy kế quý', Y: 'Lũy kế năm'},
			draw: {N: 'Không', R: 'Ứng trước có thu hồi', G: 'Bảo đảm tối thiểu'},
			overrideBasis: {B: 'Doanh số của cấp dưới', C: 'Hoa hồng của cấp dưới'},
			method: {P: 'Tỷ lệ cố định', G: 'Thang lũy tiến', S: 'Thang bậc', A: 'Theo % đạt chỉ tiêu', U: 'Đơn giá / sản phẩm', B: 'Thưởng mốc'},
			itemType: {InvtPart: 'Hàng tồn kho', NonInvtPart: 'Hàng không tồn kho', Service: 'Dịch vụ', Assembly: 'Lắp ráp', Kit: 'Bộ (kit)', OthCharge: 'Phí khác', Discount: 'Chiết khấu', GiftCert: 'Phiếu quà tặng', Payment: 'Thanh toán', Markup: 'Phụ thu (markup)', DwnLdItem: 'Hàng tải về'},
			scope: {A: 'Tất cả khách hàng', N: 'Chỉ khách mới', E: 'Chỉ khách cũ'},
			methodHelp: {
				P: 'Cơ sở x tỷ lệ %.',
				G: 'Mỗi khoảng cơ sở nhân % của khoảng đó (như thuế lũy tiến).',
				S: 'Toàn bộ cơ sở nhân % của bậc cao nhất đạt được.',
				A: 'Toàn bộ cơ sở nhân % của bậc % đạt chỉ tiêu (tăng tốc / giảm tốc).',
				U: 'Số lượng bán x số tiền mỗi đơn vị.',
				B: 'Số tiền cố định của bậc % đạt cao nhất đã qua.',
			},
			tranType: {I: 'Hóa đơn', S: 'Bán thu tiền ngay', C: 'Credit memo'},
			run: {
				month: 'Tháng',
				sub: (name, from, to) => `${name} - từ ${from} đến ${to}`,
				subNone: (m) => `Tháng ${m} chưa có bảng tính. Bấm Tính để lấy giao dịch bán hàng và tính hoa hồng.`,
				calcAt: (v) => `tính lúc ${v}`,
				batch: 'Bảng lương',
				calc: 'Tính',
				recalc: 'Tính lại',
				approve: 'Duyệt',
				reopen: 'Mở lại',
				void: 'Hủy',
				reasons: {
					readOnly: 'Chỉ kế toán (hoặc quản trị) được thao tác bảng tính hoa hồng.',
					noRun: 'Chưa có bảng tính của tháng này.',
					notApproved: 'Bảng tính chưa duyệt.',
					approved: 'Bảng tính đã duyệt: mở lại trước khi tính lại hoặc hủy.',
					posted: 'Bảng tính đã vào bảng lương: đảo bảng lương trước.',
				},
				calculating: 'Đang tính hoa hồng...',
				calculated: (n) => `Đã tính hoa hồng cho ${n} nhân viên.`,
				calculatedNoCount: 'Đã tính hoa hồng.',
				runWarnings: 'Doanh số chưa ai được ghi nhận',
				confirmRecalc: (name) => `Tính lại bảng tính ${name}? Kết quả nháp hiện tại được thay bằng kết quả mới (điều chỉnh tay vẫn giữ).`,
				confirmApprove: (name, amount) => `Duyệt bảng tính ${name}, tổng hoa hồng ${amount}? Bảng lương có kỳ chứa ngày cuối của bảng tính sẽ lấy số này.`,
				approved: (name) => `Đã duyệt bảng tính ${name}.`,
				confirmReopen: (name) => `Mở lại bảng tính ${name} về nháp?`,
				reopened: (name) => `Đã mở lại bảng tính ${name}.`,
				voidTitle: (name) => `Hủy bảng tính ${name}`,
				voidIntro: 'Bảng tính bị đánh dấu không còn hiệu lực (không xóa). Tính lại tháng này sẽ tạo bảng tính mới.',
				voidReason: 'Lý do hủy',
				voidErr: 'Nhập lý do hủy.',
				voidRun: 'Hủy bảng tính',
				back: 'Quay lại',
				voided: (name) => `Đã hủy bảng tính ${name}.`,
			},
			kpi: {
				base: 'Tổng cơ sở tính',
				baseNote: 'Doanh thu / lãi gộp / số lượng theo kế hoạch',
				amount: 'Tổng hoa hồng phải trả',
				amountNote: (n) => (n ? `${n} cảnh báo cần xem` : 'Sau trần, điều chỉnh và ứng trước'),
				employees: 'Nhân viên',
				employeesNote: 'Có kết quả trong tháng',
				attainment: 'Bình quân % đạt',
				attainmentNote: 'Trên các dòng có chỉ tiêu',
			},
			cols: {code: 'Mã NV', name: 'Nhân viên', plan: 'Kế hoạch', quota: 'Chỉ tiêu', base: 'Cơ sở', attainment: '% đạt', earned: 'Hoa hồng kỳ', override: 'Quản lý', adjustments: 'Điều chỉnh', capped: 'Bị cắt', drawPaid: 'Ứng trước', payable: 'Phải trả', warnings: 'Cảnh báo'},
			search: 'Tìm mã, tên, kế hoạch, số tiền',
			empty: 'Chưa có kết quả. Bấm Tính để tính hoa hồng tháng này.',
			total: (n) => `Tổng ${n} dòng`,
			side: {
				explain: 'Diễn giải',
				credits: 'Giao dịch',
				shares: 'Phân đoạn',
				adjust: 'Điều chỉnh',
				label: 'Chi tiết kết quả',
				loading: 'Đang tải diễn giải...',
				failed: 'Không tải được diễn giải.',
				retry: 'Thử lại',
				pick: 'Chọn một dòng để xem diễn giải.',
				summary: {quota: 'Chỉ tiêu', base: 'Cơ sở trong kỳ', windowBase: 'Cơ sở lũy kế cửa sổ', attainment: '% đạt', gross: 'Hoa hồng lũy kế cửa sổ', priorPaid: 'Đã trả các kỳ trước', earned: 'Hoa hồng kỳ này', override: 'Hoa hồng quản lý', adjustments: 'Điều chỉnh tay', capped: 'Bị cắt bởi trần', drawPaid: 'Ứng trước trả bù', drawRecovered: 'Thu hồi ứng trước', drawBalance: 'Số dư ứng trước', payable: 'Phải trả vào lương'},
				warnings: 'Cảnh báo',
				components: 'Thành phần',
				steps: 'Các bước tính',
				noSteps: 'Không có dòng diễn giải.',
				compCols: {name: 'Thành phần', method: 'Cách tính', base: 'Cơ sở', amount: 'Hoa hồng'},
				credit: {source: 'Nguồn', search: 'Tìm số chứng từ, khách, mặt hàng, nguồn', tranNo: 'Số chứng từ', date: 'Ngày', customer: 'Khách', item: 'Mặt hàng', pct: '% ghi nhận', base: 'Cơ sở', empty: 'Không có giao dịch được ghi nhận.', open: 'Bấm một dòng để mở chứng từ.'},
				share: {search: 'Tìm phòng ban, lớp, địa điểm, dự án', department: 'Phòng ban', cls: 'Lớp (class)', location: 'Địa điểm', project: 'Dự án', amount: 'Số tiền', empty: 'Chưa có phân bổ theo phân đoạn.'},
				adj: {
					add: 'Thêm điều chỉnh',
					plan: 'Kế hoạch',
					amount: 'Số tiền',
					amountHint: 'Âm để giảm (ví dụ -500.000)',
					reason: 'Lý do',
					save: 'Thêm',
					errAmount: 'Nhập số tiền khác 0.',
					errReason: 'Nhập lý do điều chỉnh.',
					errPlan: 'Chọn kế hoạch.',
					saving: 'Đang thêm điều chỉnh...',
					saved: 'Đã thêm điều chỉnh. Bấm Tính lại để đưa vào bảng tính.',
					locked: 'Bảng tính đã duyệt hoặc đã vào lương: mở lại trước khi điều chỉnh.',
					list: 'Điều chỉnh đã có',
					search: 'Tìm lý do, số tiền',
					empty: 'Chưa có điều chỉnh tay.',
					cols: {date: 'Ngày', plan: 'Kế hoạch', amount: 'Số tiền', reason: 'Lý do', by: 'Người lập'},
				},
			},
			plans: {
				newPlan: 'Tạo kế hoạch',
				search: 'Tìm mã, mô tả, loại thu nhập',
				empty: 'Chưa có kế hoạch hoa hồng. Bấm Tạo kế hoạch.',
				cols: {source: 'Nguồn', name: 'Mã kế hoạch', description: 'Mô tả', basis: 'Cơ sở', window: 'Cửa sổ', components: 'Thành phần', assignees: 'Nhân viên', effective: 'Hiệu lực', earningType: 'Loại thu nhập', state: 'Tình trạng'},
				active: 'Đang dùng',
				inactive: 'Ngừng',
				expired: 'Hết hạn',
				range: (a, b) => `${a || '...'} - ${b || '...'}`,
				backToList: 'Danh sách kế hoạch',
				save: 'Lưu kế hoạch',
				discard: 'Bỏ thay đổi',
				saving: 'Đang lưu kế hoạch...',
				saved: (name) => `Đã lưu kế hoạch ${name}.`,
				dirty: 'Có thay đổi chưa lưu',
				confirmLeave: 'Bỏ các thay đổi chưa lưu của kế hoạch này?',
				newTitle: 'Kế hoạch mới',
				form: 'Thông tin kế hoạch',
				f: {
					source: 'Nguồn doanh số', sourceHint: 'Dữ liệu ngoài nạp ở tab Doanh số ngoài',
					name: 'Mã kế hoạch', description: 'Mô tả', subsidiary: 'Công ty con', allSubs: 'Mọi công ty', effective: 'Hiệu lực từ', expiration: 'Đến ngày', earningType: 'Loại thu nhập', basis: 'Cơ sở tính', trigger: 'Ghi nhận khi', creditSource: 'Người được ghi nhận', creditField: 'Id trường nhân viên trên chứng từ', creditFieldHint: 'Ví dụ custbody_sales_agent', window: 'Cửa sổ tính', includeReturns: 'Trừ hàng trả lại (credit memo)', clawbackDays: 'Truy thu hóa đơn quá hạn (ngày)', clawbackHint: '0 = tắt; chỉ áp khi ghi nhận lúc xuất hóa đơn', excludeItemTypes: 'Loại dòng bỏ qua', excludeHint: 'Cách nhau dấu phẩy', minAttainment: 'Ngưỡng % đạt tối thiểu', minHint: 'Dưới ngưỡng thì hoa hồng theo doanh số = 0', capAmount: 'Trần mỗi kỳ', capHint: 'Trống = không trần', drawType: 'Ứng trước (draw)', drawAmount: 'Mức ứng trước mỗi kỳ', overridePct: 'Hoa hồng quản lý %', overrideBasis: 'Tính trên', overrideHint: 'Quản lý khai ở lưới phân công',
					itemGroupField: 'Trường nhóm hàng trên mặt hàng (custitem...)', itemGroupFieldHint: 'Id trường tùy chỉnh của mặt hàng chứa nhóm hàng do doanh nghiệp tự định nghĩa, ví dụ custitem_nhom_hang; lọc so theo tên hiển thị. Trống = lọc nhóm hàng chỉ áp cho doanh số ngoài.',
				},
				err: {required: 'Bắt buộc.', dateOrder: 'Ngày kết thúc trước ngày bắt đầu.', positive: 'Nhập số tiền lớn hơn 0.', noRules: 'Kế hoạch cần ít nhất một thành phần.', ruleName: 'Thành phần thiếu tên.', rate: 'Nhập tỷ lệ %.', unit: 'Nhập đơn giá.', tiers: 'Thêm ít nhất một bậc.', tierValues: 'Bậc thiếu giá trị.', employee: 'Chọn nhân viên.', quotaRow: 'Chọn nhân viên, tháng và nhập chỉ tiêu.', groupField: 'Id trường phải dạng custitem... (chữ thường, số, gạch dưới).', newDays: 'Nhập số ngày tính là khách mới (số nguyên từ 1).', noGroupField: 'Lọc nhóm hàng cần khai Trường nhóm hàng trên kế hoạch.', fix: (n) => `Còn ${n} ô chưa hợp lệ, xem các dòng báo đỏ.`},
				rules: 'Thành phần (cách tính)',
				rulesSearch: 'Tìm tên, cách tính',
				rulesEmpty: 'Chưa có thành phần.',
				addRule: 'Thêm thành phần',
				newRuleName: (n) => `Thành phần ${n}`,
				ruleCols: {sequence: 'TT', name: 'Tên', method: 'Cách tính', value: 'Tỷ lệ / đơn giá', filters: 'Bộ lọc', remove: ''},
				tiersCount: (n) => `${n} bậc`,
				filtersCount: (n) => (n ? `${n} điều kiện` : 'Mọi giao dịch'),
				sum: {types: (x) => `Loại: ${x}`, codes: (x) => `Mã: ${x}`, groups: (x) => `Nhóm: ${x}`, scopeN: (d) => `Khách mới (${d} ngày)`, scopeE: (d) => `Khách cũ (trên ${d} ngày)`, others: (n) => `${n} điều kiện khác`},
				remove: 'Bỏ',
				removeOf: (name) => `Bỏ ${name}`,
				rule: {
					title: (name) => `Thành phần: ${name}`,
					pick: 'Chọn một thành phần ở lưới bên trái để sửa.',
					name: 'Tên thành phần', sequence: 'Thứ tự', method: 'Cách tính', rate: 'Tỷ lệ %', unitAmount: 'Số tiền mỗi đơn vị',
					methods: 'Các cách tính',
					filters: 'Bộ lọc giao dịch (trống = không lọc)',
					classes: 'Lớp (class)', departments: 'Phòng ban', locations: 'Địa điểm', custCategories: 'Nhóm khách hàng', items: 'Mặt hàng', itemsHint: 'Id nội bộ mặt hàng, cách nhau dấu phẩy',
					add: 'Thêm...',
					removeChip: (name) => `Bỏ điều kiện ${name}`,
					itemTypes: 'Loại mặt hàng',
					itemCodes: 'Mã hàng',
					itemCodesHint: 'Gõ mã rồi Enter, hoặc dán nhiều mã cách nhau dấu phẩy / xuống dòng; không phân biệt hoa thường. Áp cho cả doanh số ngoài.',
					itemGroups: 'Nhóm hàng',
					itemGroupsHint: (field) => (field ? `Giá trị của trường ${field} (theo tên hiển thị) hoặc cột Nhóm hàng của doanh số ngoài; gõ rồi Enter hoặc dán nhiều giá trị.` : 'Kế hoạch chưa khai trường nhóm hàng: chỉ dòng doanh số ngoài có cột Nhóm hàng được lọc.'),
					tokenPh: 'Gõ rồi Enter...',
					customerScope: 'Phạm vi khách hàng',
					newDays: 'Số ngày tính là khách mới',
					scopeHelp: (d) => `Khách mới: lần mua đầu tiên (hóa đơn hoặc bán thu tiền ngay đã ghi sổ) cách ngày chứng từ không quá ${d} ngày; khách cũ: hơn ${d} ngày. Dòng doanh số ngoài có cột Loại KH thì dùng thẳng giá trị đó. Dòng thiếu ngày mua đầu tiên không được tính và có cảnh báo.`,
					tiers: 'Bậc thang',
					noTiers: 'Cách tính này không dùng bậc thang.',
					addTier: 'Thêm bậc',
					tierFromMoney: 'Từ cơ sở',
					tierFromPct: 'Từ % đạt',
					tierRate: 'Tỷ lệ %',
					tierAmount: 'Tiền thưởng',
					tiersEmpty: 'Chưa có bậc.',
					tierOrder: 'Bậc được sắp theo giá trị "từ" khi lưu.',
				},
				assign: 'Phân công nhân viên',
				assignSearch: 'Tìm nhân viên, quản lý, chỉ tiêu',
				assignEmpty: 'Chưa phân công nhân viên nào.',
				addAssign: 'Thêm nhân viên',
				assignCols: {employee: 'Nhân viên', effective: 'Từ ngày', expiration: 'Đến ngày', quota: 'Chỉ tiêu tháng', manager: 'Quản lý nhận hoa hồng', remove: ''},
				noManager: 'Không có',
				pickEmployee: 'Chọn nhân viên',
				quotas: 'Chỉ tiêu riêng theo tháng',
				quotasHint: 'Ghi đè chỉ tiêu tháng của phân công cho đúng tháng đó.',
				quotasSearch: 'Tìm nhân viên, tháng, chỉ tiêu',
				quotasEmpty: 'Chưa có chỉ tiêu riêng.',
				addQuota: 'Thêm chỉ tiêu',
				quotaCols: {employee: 'Nhân viên', month: 'Tháng', quota: 'Chỉ tiêu', remove: ''},
			},
			sim: {
				intro: 'Thử nhanh một kế hoạch: nhập doanh số (hoặc số lượng) và chỉ tiêu, kết quả tự tính lại sau khi gõ.',
				plan: 'Kế hoạch',
				pickPlan: 'Chọn kế hoạch',
				base: 'Cơ sở (doanh thu / lãi gộp)',
				qty: 'Số lượng',
				quota: 'Chỉ tiêu',
				quotaHint: 'Cần cho cách tính theo % đạt và thưởng mốc',
				result: 'Kết quả mô phỏng',
				amount: 'Hoa hồng',
				attainment: '% đạt',
				working: 'Đang tính...',
				waiting: 'Chọn kế hoạch và nhập cơ sở hoặc số lượng.',
				failed: 'Không mô phỏng được.',
				noPlans: 'Chưa có kế hoạch. Tạo kế hoạch ở tab Kế hoạch trước.',
			},
		},
	},
	en: {
		cm: {
			title: 'Commission',
			noSubsidiary: 'No subsidiary selected.',
			noRole: 'Your role cannot view commissions.',
			readOnly: 'Your role is view only.',
			loading: 'Loading...',
			refresh: 'Refresh',
			tabs: {run: 'Calculation', ext: 'External sales', plans: 'Plans', sim: 'Simulation', label: 'Commission sections'},
			status: {D: 'Draft calculated', A: 'Approved', P: 'In payroll', none: 'Not calculated'},
			source: {N: 'NetSuite transactions', X: 'Imported external data', B: 'Both'},
			netsuite: 'NetSuite',
			ext: {
				importBtn: 'Import external sales',
				template: 'Download CSV template',
				templateName: 'external_sales_template.csv',
				sub: (m) => `Sales lines from other systems (DMS, POS, marketplaces...) dated in ${m}. Plans whose source is "Imported external data" or "Both" use these lines.`,
				search: 'Search document, customer, item, employee, source',
				empty: 'No external sales this month. Click Import external sales to paste from Excel or choose a CSV file.',
				total: (n) => `Total of ${n} lines`,
				locked: 'Used in an approved calculation',
				cols: {source: 'Source', docNo: 'Document', line: 'Line', date: 'Date', customer: 'Customer', item: 'Item', employee: 'Employee', revenue: 'Revenue', cost: 'Cost', qty: 'Quantity', collected: 'Collected', batch: 'Import batch'},
			},
			imp: {
				title: 'Import external sales',
				system: 'Source system',
				systemHint: 'For example DMS, POS, Shopee',
				paste: 'Paste from Excel',
				pastePh: 'Select the range in Excel (including the header row), press Ctrl+C and paste here',
				file: 'Or choose a CSV file',
				fileHint: 'UTF-8, comma or semicolon separated, first row is the header',
				read: (rows, cols, delim) => `Read ${rows} rows, ${cols} columns (separator: ${delim}).`,
				delim: {tab: 'Tab', comma: 'comma', semi: 'semicolon'},
				noData: 'No data yet.',
				mapping: 'Column mapping',
				mappingHint: 'Columns are matched by their headers; correct them if needed.',
				unused: '(not used)',
				fields: {docNo: 'Document number', lineNo: 'Line', tranType: 'Type (I / S / C)', date: 'Date', customerCode: 'Customer code', customerName: 'Customer name', customerCategory: 'Customer category', itemCode: 'Item code', itemType: 'Item type (NetSuite code)', itemGroup: 'Item group', customerType: 'Customer type (N new / E existing)', revenue: 'Revenue', cost: 'Cost', qty: 'Quantity', employee: 'Employee ID or email', department: 'Department (internal id)', cls: 'Class (internal id)', location: 'Location (internal id)', collectedDate: 'Collected date', collectedAmount: 'Collected amount'},
				missingReq: (names) => `Required columns not mapped: ${names}.`,
				preview: 'Preview',
				search: 'Search document, employee, error',
				status: {pending: 'Not checked', ok: 'Valid', error: 'Error', create: 'New', update: 'Update', same: 'Unchanged'},
				counts: (total, ok, bad) => `${total} rows - ${ok} valid - ${bad} with errors`,
				errors: {noDoc: 'Missing document number', badType: 'Invalid type (I, S, C)', badDate: 'Invalid date', noEmployee: 'Missing employee ID', badNumber: 'Invalid number', noAmount: 'Missing revenue or quantity', duplicate: 'Duplicate document + line in the file', badCustType: 'Customer type must be N (new) or E (existing)'},
				cols: {row: 'Row', status: 'Status', docNo: 'Document', line: 'Doc. line', type: 'Type', date: 'Date', customer: 'Customer', item: 'Item', revenue: 'Revenue', qty: 'Quantity', employee: 'Employee', errors: 'Errors'},
				check: 'Check',
				checking: 'Checking the data...',
				checked: (ok, bad) => (bad ? `Check complete: ${ok} valid rows, ${bad} rows with errors.` : `Check complete: ${ok} valid rows.`),
				skip: 'Skip rows with errors, write valid rows only',
				write: (n) => `Write ${n} rows`,
				writing: (n) => `Writing ${n} external sales rows...`,
				confirmSkip: (ok, bad) => `Write ${ok} valid rows and skip ${bad} rows with errors?`,
				written: (n) => `${n} external sales rows written. Click Calculate (or Recalculate) in the Calculation tab to include them.`,
				needCheck: 'Click Check before writing.',
				needFix: 'Some rows have errors: fix the file and paste again, or choose to skip them.',
				errSystem: 'Enter the source system name.',
				close: 'Close',
				fileFailed: 'The file could not be read.',
			},
			basis: {R: 'Net revenue', G: 'Estimated gross profit', Q: 'Quantity sold'},
			trigger: {I: 'On invoice', P: 'On payment'},
			credit: {R: 'Sales rep on the transaction', T: 'Sales team (contribution %)', F: 'Custom field'},
			window: {M: 'Monthly', Q: 'Quarter to date', Y: 'Year to date'},
			draw: {N: 'None', R: 'Recoverable draw', G: 'Guaranteed minimum'},
			overrideBasis: {B: 'Subordinates sales', C: 'Subordinates commission'},
			method: {P: 'Flat rate', G: 'Graduated tiers', S: 'Step tiers', A: 'Attainment based', U: 'Per unit', B: 'Milestone bonus'},
			itemType: {InvtPart: 'Inventory item', NonInvtPart: 'Non-inventory item', Service: 'Service', Assembly: 'Assembly', Kit: 'Kit / package', OthCharge: 'Other charge', Discount: 'Discount', GiftCert: 'Gift certificate', Payment: 'Payment', Markup: 'Markup', DwnLdItem: 'Download item'},
			scope: {A: 'All customers', N: 'New customers only', E: 'Existing customers only'},
			methodHelp: {
				P: 'Base x rate %.',
				G: 'Each slice of the base times the rate of that slice (like progressive tax).',
				S: 'The whole base times the rate of the highest tier reached.',
				A: 'The whole base times the rate of the attainment tier (accelerator / decelerator).',
				U: 'Quantity sold x amount per unit.',
				B: 'Fixed amount of the highest attainment tier passed.',
			},
			tranType: {I: 'Invoice', S: 'Cash sale', C: 'Credit memo'},
			run: {
				month: 'Month',
				sub: (name, from, to) => `${name} - from ${from} to ${to}`,
				subNone: (m) => `No calculation for ${m} yet. Click Calculate to read sales transactions and compute commissions.`,
				calcAt: (v) => `calculated at ${v}`,
				batch: 'Payroll batch',
				calc: 'Calculate',
				recalc: 'Recalculate',
				approve: 'Approve',
				reopen: 'Reopen',
				void: 'Void',
				reasons: {
					readOnly: 'Only accounting (or an administrator) can operate commission calculations.',
					noRun: 'There is no calculation for this month.',
					notApproved: 'The calculation is not approved.',
					approved: 'The calculation is approved: reopen it before recalculating or voiding.',
					posted: 'The calculation is in payroll: reverse the payroll batch first.',
				},
				calculating: 'Calculating commissions...',
				calculated: (n) => `Commissions calculated for ${n} employees.`,
				calculatedNoCount: 'Commissions calculated.',
				runWarnings: 'Sales not credited to anyone',
				confirmRecalc: (name) => `Recalculate ${name}? The current draft results are replaced (manual adjustments are kept).`,
				confirmApprove: (name, amount) => `Approve ${name}, total commission ${amount}? The payroll batch whose period contains the end date will pick it up.`,
				approved: (name) => `${name} approved.`,
				confirmReopen: (name) => `Reopen ${name} back to draft?`,
				reopened: (name) => `${name} reopened.`,
				voidTitle: (name) => `Void ${name}`,
				voidIntro: 'The calculation is marked inactive (not deleted). Calculating this month again creates a new one.',
				voidReason: 'Reason',
				voidErr: 'Enter the reason.',
				voidRun: 'Void calculation',
				back: 'Back',
				voided: (name) => `${name} voided.`,
			},
			kpi: {
				base: 'Total base',
				baseNote: 'Revenue / gross profit / quantity per plan',
				amount: 'Total commission payable',
				amountNote: (n) => (n ? `${n} warnings to review` : 'After cap, adjustments and draw'),
				employees: 'Employees',
				employeesNote: 'With a result this month',
				attainment: 'Average attainment',
				attainmentNote: 'Over rows with a quota',
			},
			cols: {code: 'Emp. ID', name: 'Employee', plan: 'Plan', quota: 'Quota', base: 'Base', attainment: 'Attainment', earned: 'Earned', override: 'Override', adjustments: 'Adjustments', capped: 'Capped', drawPaid: 'Draw', payable: 'Payable', warnings: 'Warnings'},
			search: 'Search ID, name, plan, amount',
			empty: 'No results yet. Click Calculate to compute commissions for this month.',
			total: (n) => `Total of ${n} rows`,
			side: {
				explain: 'Explanation',
				credits: 'Transactions',
				shares: 'Segments',
				adjust: 'Adjustments',
				label: 'Result details',
				loading: 'Loading the explanation...',
				failed: 'The explanation could not be loaded.',
				retry: 'Retry',
				pick: 'Select a row to see the explanation.',
				summary: {quota: 'Quota', base: 'Base this period', windowBase: 'Window to date base', attainment: 'Attainment', gross: 'Window to date commission', priorPaid: 'Paid in earlier periods', earned: 'Earned this period', override: 'Override commission', adjustments: 'Manual adjustments', capped: 'Cut by the cap', drawPaid: 'Draw paid', drawRecovered: 'Draw recovered', drawBalance: 'Draw balance', payable: 'Payable through payroll'},
				warnings: 'Warnings',
				components: 'Components',
				steps: 'Calculation steps',
				noSteps: 'No explanation lines.',
				compCols: {name: 'Component', method: 'Method', base: 'Base', amount: 'Commission'},
				credit: {source: 'Source', search: 'Search document, customer, item, source', tranNo: 'Document', date: 'Date', customer: 'Customer', item: 'Item', pct: 'Credit %', base: 'Base', empty: 'No credited transactions.', open: 'Click a row to open the transaction.'},
				share: {search: 'Search department, class, location, project', department: 'Department', cls: 'Class', location: 'Location', project: 'Project', amount: 'Amount', empty: 'No segment allocation yet.'},
				adj: {
					add: 'Add adjustment',
					plan: 'Plan',
					amount: 'Amount',
					amountHint: 'Negative to reduce (for example -500,000)',
					reason: 'Reason',
					save: 'Add',
					errAmount: 'Enter a non-zero amount.',
					errReason: 'Enter the reason.',
					errPlan: 'Select a plan.',
					saving: 'Adding the adjustment...',
					saved: 'Adjustment added. Click Recalculate to include it.',
					locked: 'The calculation is approved or in payroll: reopen it before adjusting.',
					list: 'Existing adjustments',
					search: 'Search reason, amount',
					empty: 'No manual adjustments.',
					cols: {date: 'Date', plan: 'Plan', amount: 'Amount', reason: 'Reason', by: 'Created by'},
				},
			},
			plans: {
				newPlan: 'New plan',
				search: 'Search code, description, earning type',
				empty: 'No commission plans yet. Click New plan.',
				cols: {source: 'Source', name: 'Plan code', description: 'Description', basis: 'Basis', window: 'Window', components: 'Components', assignees: 'Employees', effective: 'Effective', earningType: 'Earning type', state: 'State'},
				active: 'Active',
				inactive: 'Inactive',
				expired: 'Expired',
				range: (a, b) => `${a || '...'} - ${b || '...'}`,
				backToList: 'Plan list',
				save: 'Save plan',
				discard: 'Discard changes',
				saving: 'Saving the plan...',
				saved: (name) => `Plan ${name} saved.`,
				dirty: 'Unsaved changes',
				confirmLeave: 'Discard the unsaved changes of this plan?',
				newTitle: 'New plan',
				form: 'Plan details',
				f: {
					source: 'Sales source', sourceHint: 'External data is imported in the External sales tab',
					name: 'Plan code', description: 'Description', subsidiary: 'Subsidiary', allSubs: 'All subsidiaries', effective: 'Effective from', expiration: 'Until', earningType: 'Earning type', basis: 'Basis', trigger: 'Credit when', creditSource: 'Credited person', creditField: 'Employee field id on the transaction', creditFieldHint: 'For example custbody_sales_agent', window: 'Window', includeReturns: 'Deduct returns (credit memos)', clawbackDays: 'Claw back overdue invoices (days)', clawbackHint: '0 = off; only when crediting on invoice', excludeItemTypes: 'Line types to skip', excludeHint: 'Comma separated', minAttainment: 'Minimum attainment %', minHint: 'Below it, sales based commission is 0', capAmount: 'Cap per period', capHint: 'Empty = no cap', drawType: 'Draw', drawAmount: 'Draw amount per period', overridePct: 'Override %', overrideBasis: 'Calculated on', overrideHint: 'Managers are set in the assignment grid',
					itemGroupField: 'Item group field on items (custitem...)', itemGroupFieldHint: 'Id of the item custom field holding the item group defined by the business, for example custitem_item_group; filters compare its display text. Empty = item group filters only apply to external sales.',
				},
				err: {required: 'Required.', dateOrder: 'The end date is before the start date.', positive: 'Enter an amount greater than zero.', noRules: 'The plan needs at least one component.', ruleName: 'The component has no name.', rate: 'Enter the rate %.', unit: 'Enter the unit amount.', tiers: 'Add at least one tier.', tierValues: 'A tier is missing values.', employee: 'Select the employee.', quotaRow: 'Select the employee and month, and enter the quota.', groupField: 'The field id must look like custitem... (lowercase letters, digits, underscores).', newDays: 'Enter the new customer days (a whole number from 1).', noGroupField: 'Item group filters need the item group field of the plan.', fix: (n) => `${n} fields are invalid, see the rows in red.`},
				rules: 'Components (calculation methods)',
				rulesSearch: 'Search name, method',
				rulesEmpty: 'No components yet.',
				addRule: 'Add component',
				newRuleName: (n) => `Component ${n}`,
				ruleCols: {sequence: 'Seq.', name: 'Name', method: 'Method', value: 'Rate / unit amount', filters: 'Filters', remove: ''},
				tiersCount: (n) => `${n} tiers`,
				filtersCount: (n) => (n ? `${n} conditions` : 'All transactions'),
				sum: {types: (x) => `Type: ${x}`, codes: (x) => `Code: ${x}`, groups: (x) => `Group: ${x}`, scopeN: (d) => `New customers (${d} days)`, scopeE: (d) => `Existing customers (over ${d} days)`, others: (n) => `${n} other conditions`},
				remove: 'Remove',
				removeOf: (name) => `Remove ${name}`,
				rule: {
					title: (name) => `Component: ${name}`,
					pick: 'Select a component in the grid on the left to edit it.',
					name: 'Component name', sequence: 'Sequence', method: 'Method', rate: 'Rate %', unitAmount: 'Amount per unit',
					methods: 'Calculation methods',
					filters: 'Transaction filters (empty = no filter)',
					classes: 'Classes', departments: 'Departments', locations: 'Locations', custCategories: 'Customer categories', items: 'Items', itemsHint: 'Item internal ids, comma separated',
					add: 'Add...',
					removeChip: (name) => `Remove condition ${name}`,
					itemTypes: 'Item types',
					itemCodes: 'Item codes',
					itemCodesHint: 'Type a code and press Enter, or paste several codes separated by commas / new lines; case-insensitive. Also applies to external sales.',
					itemGroups: 'Item groups',
					itemGroupsHint: (field) => (field ? `Values of the field ${field} (by display text) or the item group column of external sales; type and press Enter or paste several values.` : 'The plan has no item group field: only external sales rows with an item group column are filtered.'),
					tokenPh: 'Type and press Enter...',
					customerScope: 'Customer scope',
					newDays: 'Days counted as a new customer',
					scopeHelp: (d) => `New customer: first sale (posted invoice or cash sale) at most ${d} days before the document date; existing customer: more than ${d} days. External sales rows with a customer type column use that value directly. Lines without a first sale date are skipped with a warning.`,
					tiers: 'Tiers',
					noTiers: 'This method does not use tiers.',
					addTier: 'Add tier',
					tierFromMoney: 'From base',
					tierFromPct: 'From attainment %',
					tierRate: 'Rate %',
					tierAmount: 'Bonus amount',
					tiersEmpty: 'No tiers yet.',
					tierOrder: 'Tiers are sorted by their "from" value when saved.',
				},
				assign: 'Employee assignments',
				assignSearch: 'Search employee, manager, quota',
				assignEmpty: 'No employees assigned yet.',
				addAssign: 'Add employee',
				assignCols: {employee: 'Employee', effective: 'From', expiration: 'Until', quota: 'Monthly quota', manager: 'Manager receiving override', remove: ''},
				noManager: 'None',
				pickEmployee: 'Select employee',
				quotas: 'Monthly quota overrides',
				quotasHint: 'Overrides the assignment quota for that month only.',
				quotasSearch: 'Search employee, month, quota',
				quotasEmpty: 'No quota overrides.',
				addQuota: 'Add quota',
				quotaCols: {employee: 'Employee', month: 'Month', quota: 'Quota', remove: ''},
			},
			sim: {
				intro: 'Try a plan quickly: enter sales (or quantity) and the quota, the result recalculates as you type.',
				plan: 'Plan',
				pickPlan: 'Select plan',
				base: 'Base (revenue / gross profit)',
				qty: 'Quantity',
				quota: 'Quota',
				quotaHint: 'Needed by attainment based and milestone methods',
				result: 'Simulation result',
				amount: 'Commission',
				attainment: 'Attainment',
				working: 'Calculating...',
				waiting: 'Select a plan and enter the base or the quantity.',
				failed: 'The simulation failed.',
				noPlans: 'No plans yet. Create one in the Plans tab first.',
			},
		},
	},
};

// ================================================================== màn hình

const RUN_TONE = {D: 'warn', A: 'info', P: 'ok'};
const BASIS = ['R', 'G', 'Q'];
const TRIGGERS = ['I', 'P'];
const CREDITS = ['R', 'T', 'F'];
const WINDOWS = ['M', 'Q', 'Y'];
const DRAWS = ['N', 'R', 'G'];
const OVERRIDES = ['B', 'C'];
const METHODS = ['P', 'G', 'S', 'A', 'U', 'B'];
const SOURCES = ['N', 'X', 'B'];
const SUB_TABS = ['run', 'ext', 'plans', 'sim'];
const TRAN_RECORD = {I: 'invoice', S: 'cashsale', C: 'creditmemo'};
const SIM_DELAY = 400;
const FILTER_KEYS = [
	{key: 'fClasses', lookup: 'classes', label: 'classes'},
	{key: 'fDepartments', lookup: 'departments', label: 'departments'},
	{key: 'fLocations', lookup: 'locations', label: 'locations'},
	{key: 'fCustCategories', lookup: 'customerCategories', label: 'custCategories'},
];

const opts = (codes, labels) => codes.map((c) => ({value: c, label: (labels && labels[c]) || c}));
const sumBy = (rows, key) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
const labelOf = (options, value) => {
	const o = (options || []).find((x) => x.value === String(value));
	return o ? o.label : str(value);
};

export default function CommissionView({app}) {
	const t = pick(TEXT).cm;
	const boot = app.boot || {};
	const roles = rolesOf(boot.user);
	const canWrite = roles.canWrite;
	const subsidiary = app.subsidiary || '';
	const params = (app.route && app.route.params) || {};

	const [tab, setTab] = useState(SUB_TABS.indexOf(params.tab) >= 0 ? params.tab : 'run');
	const [month, setMonth] = useState(/^\d{4}-\d{2}$/.test(str(params.month)) ? params.month : previousMonth(localToday()));
	const [view, setView] = useState(null);
	const [stamp, setStamp] = useState(0);
	const [selected, setSelected] = useState('');
	const detailsRef = useRef({});
	const [details, setDetails] = useState({});
	const [sideTab, setSideTab] = useState('explain');
	const adjRef = useRef({plan: '', amount: '', reason: '', errors: {}});
	const [adj, setAdj] = useState(adjRef.current);
	const voidRef = useRef(null);
	const [voidDlg, setVoidDlg] = useState(null);
	const setupRef = useRef(null);
	const [setup, setSetup] = useState(null);
	const draftRef = useRef(null);
	const [draft, setDraft] = useState(null);
	const [ruleKey, setRuleKey] = useState('');
	const [errs, setErrs] = useState(null);
	const simRef = useRef({plan: '', base: '', qty: '', quota: ''});
	const [sim, setSim] = useState(simRef.current);
	const [simOut, setSimOut] = useState({state: '', data: null, error: ''});
	const alive = useRef(true);
	const viewSeq = useRef(0);
	const simSeq = useRef(0);
	const simTimer = useRef(null);
	const [ext, setExt] = useState(null);
	const extSeq = useRef(0);
	const impRef = useRef(null);
	const [imp, setImp] = useState(null);
	const fileReader = useRef(null);

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			if (simTimer.current) clearTimeout(simTimer.current);
		};
	}, []);

	// ------------------------------------------------------------------ nạp dữ liệu
	const putDetails = (next) => {
		detailsRef.current = next;
		setDetails(next);
	};
	const loadView = () => {
		if (!subsidiary || !roles.canRead || !monthInt(month)) return Promise.resolve();
		viewSeq.current += 1;
		const mine = viewSeq.current;
		return app.run(t.loading, call({action: ACTIONS.view, subsidiary, month: monthInt(month)})).then((r) => {
			if (!alive.current || mine !== viewSeq.current || !r) return;
			putDetails({});
			setView(mapView(r));
			setStamp(Date.now());
		});
	};
	useEffect(() => {
		loadView();
	}, [subsidiary, month]);

	const loadSetup = (force) => {
		if (!subsidiary || !roles.canRead) return Promise.resolve(null);
		const cur = setupRef.current;
		if (cur && cur.sub === subsidiary && !force) return Promise.resolve(cur);
		return app.run(t.loading, call({action: ACTIONS.setup, subsidiary})).then((r) => {
			if (!alive.current || !r) return null;
			const next = Object.assign(mapSetup(r), {sub: subsidiary});
			setupRef.current = next;
			setSetup(next);
			return next;
		});
	};
	useEffect(() => {
		if (tab !== 'run' || sideTab === 'adjust') loadSetup(false);
	}, [tab, subsidiary, sideTab]);

	const rows = view ? view.rows : [];
	const run = view ? view.run : null;
	const current = rows.find((r) => r.id === selected) || rows[0] || null;
	const currentId = current ? current.resultId : '';

	const loadDetail = (id) => {
		if (!id) return;
		putDetails(Object.assign({}, detailsRef.current, {[id]: {state: 'loading'}}));
		call({action: ACTIONS.result, id}).then(
			(r) => {
				if (!alive.current) return;
				putDetails(Object.assign({}, detailsRef.current, {[id]: {state: 'ok', data: mapResult(r)}}));
			},
			(e) => {
				if (!alive.current) return;
				putDetails(Object.assign({}, detailsRef.current, {[id]: {state: 'error', error: errorText(e)}}));
			}
		);
	};
	useEffect(() => {
		if (tab === 'run' && currentId && !detailsRef.current[currentId]) loadDetail(currentId);
	}, [currentId, stamp, tab]);

	// ------------------------------------------------------------------ thao tác bảng tính
	const acts = runActions(run, canWrite);
	const runName = run ? run.name || run.id : '';
	const after = (r, doneText) => {
		if (!r || !alive.current) return r;
		return loadView().then(() => {
			if (alive.current) app.notify(typeof doneText === 'function' ? doneText(r) : doneText, 'ok');
			return r;
		});
	};
	const calculate = () => {
		const go = () =>
			app.run(t.run.calculating, post({action: ACTIONS.calculate, subsidiary, month: monthInt(month)})).then((r) =>
				after(r, (res) => {
					const n = numv(rd(res, 'employees', 'count', 'results'));
					return n ? t.run.calculated(n) : t.run.calculatedNoCount;
				})
			);
		if (run && run.id) app.confirm(t.run.confirmRecalc(runName), go);
		else go();
	};
	const approve = () => app.confirm(t.run.confirmApprove(runName, money(view.kpis.totalAmount) || '0'), () => app.run(t.loading, post({action: ACTIONS.approve, run: run.id})).then((r) => after(r, t.run.approved(runName))));
	const reopen = () => app.confirm(t.run.confirmReopen(runName), () => app.run(t.loading, post({action: ACTIONS.reopen, run: run.id})).then((r) => after(r, t.run.reopened(runName))));
	const putVoid = (v) => {
		voidRef.current = v;
		setVoidDlg(v);
	};
	const submitVoid = () => {
		const d = voidRef.current;
		if (!d) return;
		const reason = str(d.reason).trim();
		if (!reason) {
			putVoid(Object.assign({}, d, {error: t.run.voidErr}));
			return;
		}
		putVoid(null);
		app.run(t.loading, post({action: ACTIONS.void, run: d.id, reason})).then((r) => after(r, t.run.voided(d.name)));
	};

	// ------------------------------------------------------------------ điều chỉnh tay
	const putAdj = (patch) => {
		adjRef.current = Object.assign({}, adjRef.current, patch);
		setAdj(adjRef.current);
	};
	const adjLocked = !!run && (run.status === 'A' || run.status === 'P');
	const saveAdjust = (row) => {
		const a = adjRef.current;
		const plan = a.plan || row.plan;
		const amount = toNumber(a.amount);
		const reason = str(a.reason).trim();
		const errors = {};
		if (!plan) errors.plan = t.side.adj.errPlan;
		if (!amount) errors.amount = t.side.adj.errAmount;
		if (!reason) errors.reason = t.side.adj.errReason;
		putAdj({errors});
		if (Object.keys(errors).length) return;
		app.run(t.side.adj.saving, post({action: ACTIONS.adjust, subsidiary, employee: row.employee, plan, month: monthInt(month), amount, reason})).then((r) => {
			if (!r || !alive.current) return;
			putAdj({amount: '', reason: '', errors: {}});
			if (row.resultId) loadDetail(row.resultId);
			app.notify(t.side.adj.saved, 'ok');
		});
	};

	// ------------------------------------------------------------------ kế hoạch
	const plans = setup ? setup.plans : [];
	const lookups = setup ? setup.lookups : {classes: [], departments: [], locations: [], customerCategories: [], employees: [], items: []};
	const employeeOptions = lookups.employees;
	const earningOptions = setup && setup.earningTypes.length
		? setup.earningTypes
		: arr(boot.earningTypes).map((e) => ({value: EARNING_TYPE_KEY === 'id' ? str(e.id) : str(e.code) || str(e.id), label: [str(e.code), str(e.name)].filter(Boolean).join(' - ')}));
	const putDraft = (next, dirty) => {
		const d = next ? Object.assign({}, next, {dirty: dirty === undefined ? true : dirty}) : null;
		draftRef.current = d;
		setDraft(d);
	};
	const patchDraft = (patch) => putDraft(Object.assign({}, draftRef.current, patch));
	const setPlanField = (k) => (v) => patchDraft({[k]: v});
	const openPlan = (p) => {
		const d = p ? mapPlan(JSON.parse(JSON.stringify(planPayloadSource(p)))) : newPlanDraft(subsidiary, localToday());
		putDraft(d, false);
		setRuleKey(d.rules.length ? d.rules[0].key : '');
		setErrs(null);
	};
	const leavePlan = () => {
		const close = () => {
			putDraft(null);
			setErrs(null);
		};
		if (draftRef.current && draftRef.current.dirty) app.confirm(t.plans.confirmLeave, close);
		else close();
	};
	const discardPlan = () => {
		const d = draftRef.current;
		if (!d) return;
		const orig = d.id ? plans.find((p) => p.id === d.id) : null;
		app.confirm(t.plans.confirmLeave, () => openPlan(orig));
	};
	const savePlan = () => {
		const d = draftRef.current;
		if (!d) return;
		const v = validatePlan(d);
		setErrs(v);
		if (v.count) {
			const badRule = Object.keys(v.rules)[0];
			if (badRule) setRuleKey(badRule);
			return;
		}
		const body = Object.assign({action: ACTIONS.planSave, subsidiary}, planPayload(d));
		app.run(t.plans.saving, post(body)).then((r) => {
			if (!r || !alive.current) return;
			const planObj = r.plan;
			const id = str(rd(r, 'id', 'planId')) || (planObj && typeof planObj === 'object' ? str(planObj.id) : str(planObj)) || d.id;
			loadSetup(true).then((sNext) => {
				if (!alive.current) return;
				const saved = sNext && id ? sNext.plans.find((p) => p.id === id) : null;
				if (saved) openPlan(saved);
				else putDraft(Object.assign({}, draftRef.current), false);
				app.notify(t.plans.saved(d.name), 'ok');
			});
		});
	};
	// Rule / phân công / chỉ tiêu
	const rulesOf = () => (draftRef.current ? draftRef.current.rules : []);
	const setRule = (key, patch) => patchDraft({rules: rulesOf().map((r) => (r.key === key ? Object.assign({}, r, patch) : r))});
	const addRule = () => {
		const r = Object.assign(newRule(rulesOf().length + 1), {name: t.plans.newRuleName(rulesOf().length + 1)});
		patchDraft({rules: rulesOf().concat([r])});
		setRuleKey(r.key);
	};
	const removeRule = (key) => {
		const next = rulesOf().filter((r) => r.key !== key);
		patchDraft({rules: next});
		if (ruleKey === key) setRuleKey(next.length ? next[0].key : '');
	};
	const setTier = (rk, tk, patch) => setRule(rk, {tiers: rulesOf().find((r) => r.key === rk).tiers.map((x) => (x.key === tk ? Object.assign({}, x, patch) : x))});
	const addTier = (rk) => setRule(rk, {tiers: rulesOf().find((r) => r.key === rk).tiers.concat([{key: newKey('nt'), id: '', fromValue: '', rate: '', amount: ''}])});
	const removeTier = (rk, tk) => setRule(rk, {tiers: rulesOf().find((r) => r.key === rk).tiers.filter((x) => x.key !== tk)});
	const listOf = (k) => (draftRef.current ? draftRef.current[k] : []);
	const setLine = (k, key, patch) => patchDraft({[k]: listOf(k).map((x) => (x.key === key ? Object.assign({}, x, patch) : x))});
	const addAssign = () => patchDraft({assignments: listOf('assignments').concat([{key: newKey('na'), id: '', employee: '', effective: draftRef.current.effective || '', expiration: '', quota: '', manager: ''}])});
	const addQuota = () => patchDraft({quotas: listOf('quotas').concat([{key: newKey('nq'), id: '', employee: '', month: month || '', quota: ''}])});
	const removeLine = (k, key) => patchDraft({[k]: listOf(k).filter((x) => x.key !== key)});

	// ------------------------------------------------------------------ mô phỏng
	const runSim = (v) => {
		if (simTimer.current) clearTimeout(simTimer.current);
		simSeq.current += 1;
		const mine = simSeq.current;
		const base = toNumber(v.base);
		const qty = toNumber(v.qty);
		if (!v.plan || (base === null && qty === null)) {
			setSimOut({state: '', data: null, error: ''});
			return;
		}
		setSimOut({state: 'working', data: simOut.data, error: ''});
		simTimer.current = setTimeout(() => {
			call({action: ACTIONS.simulate, plan: v.plan, base: base === null ? 0 : base, qty: qty === null ? 0 : qty, quota: toNumber(v.quota) === null ? undefined : toNumber(v.quota)}).then(
				(r) => {
					if (!alive.current || mine !== simSeq.current) return;
					const x = (r && (r.result || r)) || {};
					setSimOut({state: 'ok', data: {amount: numv(rd(x, 'amount', 'total')), attainment: pctOf(rd(x, 'attainment'), PCT.attainmentIsRatio), components: arr(x.components).map(mapComponent), steps: stepsOf(x.steps), warnings: arr(x.warnings)}, error: ''});
				},
				(e) => {
					if (!alive.current || mine !== simSeq.current) return;
					setSimOut({state: 'error', data: null, error: errorText(e)});
				}
			);
		}, SIM_DELAY);
	};
	const setSimField = (k) => (v) => {
		const patch = {[k]: v};
		// Chọn kế hoạch: gợi ý chỉ tiêu bằng chỉ tiêu tháng của phân công đầu tiên
		if (k === 'plan' && !str(simRef.current.quota)) {
			const p = plans.find((x) => x.id === v);
			const q = p && p.assignments.find((a) => numv(a.quota));
			if (q) patch.quota = q.quota;
		}
		simRef.current = Object.assign({}, simRef.current, patch);
		setSim(simRef.current);
		runSim(simRef.current);
	};

	// ------------------------------------------------------------------ doanh số ngoài: danh sách của tháng và hộp thoại nạp
	const loadExt = () => {
		if (!subsidiary || !roles.canRead || !monthInt(month)) return Promise.resolve();
		extSeq.current += 1;
		const mine = extSeq.current;
		return app.run(t.loading, call({action: ACTIONS.external, subsidiary, month: monthInt(month)})).then((r) => {
			if (!alive.current || mine !== extSeq.current || !r) return;
			setExt({month, sub: subsidiary, rows: arr(r.rows || r.items || r.lines).map(mapExternal)});
		});
	};
	useEffect(() => {
		if (tab === 'ext') loadExt();
	}, [tab, subsidiary, month]);

	const putImp = (v) => {
		impRef.current = v;
		setImp(v);
	};
	const patchImp = (patch) => impRef.current && putImp(Object.assign({}, impRef.current, patch));
	const withRows = (v) => Object.assign({}, v, {rows: buildImportRows(v.table, v.mapping), results: null, message: ''});
	const openImport = () => {
		const d = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const prev = impRef.current;
		putImp({system: (prev && prev.system) || '', stamp: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`, text: '', fileName: '', table: {headers: [], rows: [], delimiter: ','}, mapping: {}, rows: [], results: null, skip: false, error: '', systemError: '', message: ''});
	};
	const setImpText = (text, fileName) => {
		const prev = impRef.current;
		if (!prev) return;
		const table = parseDelimited(text);
		const sameHead = prev.table.headers.join('\u0001') === table.headers.join('\u0001') && Object.keys(prev.mapping).length;
		putImp(withRows(Object.assign({}, prev, {text, fileName: fileName === undefined ? prev.fileName : fileName, table, mapping: sameHead ? prev.mapping : guessMapping(table.headers), error: ''})));
	};
	const setImpMap = (key, v) => {
		const prev = impRef.current;
		putImp(withRows(Object.assign({}, prev, {mapping: Object.assign({}, prev.mapping, {[key]: v})})));
	};
	// File CSV: đọc bằng FileReader (UTF-8) qua trình nghe "change" gốc (UIF không bắn onChange)
	fileReader.current = (file) => {
		if (!file) return;
		try {
			const fr = new FileReader();
			fr.onload = () => alive.current && setImpText(String(fr.result || ''), file.name);
			fr.onerror = () => patchImp({error: t.imp.fileFailed});
			fr.readAsText(file, 'UTF-8');
		} catch (e) {
			patchImp({error: t.imp.fileFailed});
		}
	};
	useEffect(() => {
		if (!imp) return;
		try {
			const el = document.getElementById('s4vp-cm-file');
			if (el && !el.__s4vpFile) {
				el.__s4vpFile = true;
				el.addEventListener('change', () => fileReader.current && fileReader.current(el.files && el.files[0]));
			}
		} catch (e) {
			// bỏ qua: vẫn dán được từ Excel
		}
	});
	// Ô nhập mã hàng / nhóm hàng dạng chip: UIF không bắn sự kiện phím, nên gắn trình nghe gốc một lần cho mỗi phần tử. Enter,
	// dấu phẩy, chấm phẩy -> thêm chip; dán -> tách nhiều mã (cả xuống dòng từ Excel); rời ô -> giữ phần đang gõ; Backspace ở ô
	// trống -> bỏ chip cuối. Hàm xử lý mới nhất nằm trong tokenFns (đổi theo thành phần đang sửa).
	const tokenFns = useRef({});
	useEffect(() => {
		try {
			Object.keys(tokenFns.current).forEach((id) => {
				const el = document.getElementById(id);
				if (!el || el.__s4vpTok) return;
				el.__s4vpTok = true;
				const fn = () => tokenFns.current[id] || {add: () => {}, pop: () => {}};
				const commit = (extra) => {
					const text = `${el.value || ''}${extra || ''}`;
					el.value = '';
					if (text.trim()) fn().add(text);
				};
				el.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
						e.preventDefault();
						commit('');
					} else if (e.key === 'Backspace' && !el.value) fn().pop();
				});
				el.addEventListener('paste', (e) => {
					const data = e.clipboardData && e.clipboardData.getData('text');
					if (!data) return;
					e.preventDefault();
					commit(data);
				});
				el.addEventListener('focusout', () => commit(''));
			});
		} catch (e) {
			// bỏ qua: không gắn được thì vẫn thêm được bằng nút Thêm cạnh ô
		}
	});
	// Trạng thái từng dòng: lỗi của trình duyệt (định dạng) cộng lỗi máy chủ (mã NV không có, trùng khóa với dòng đã khóa...)
	const importView = (v) =>
		arr(v && v.rows).map((r) => {
			const sv = v.results ? v.results[r.row] : null;
			const errors = r.errors.map((c) => t.imp.errors[c] || c).concat(sv ? sv.errors.map((e) => localized(e) || e.code) : []);
			const status = errors.length || (sv && sv.status === 'error') ? 'error' : v.results ? 'ok' : 'pending';
			const statusText = status === 'ok' && sv && t.imp.status[sv.action] ? t.imp.status[sv.action] : t.imp.status[status];
			return Object.assign({}, r, {id: `i${r.row}`, status, statusText, errorText: errors.join('; '), employeeText: sv && sv.employeeName ? `${r.employee} - ${sv.employeeName}` : r.employee});
		});
	const sendImport = (list, dryRun) => {
		const v = impRef.current;
		const system = str(v.system).trim();
		const out = [];
		let chain = Promise.resolve();
		const batch = `${system}-${v.stamp}`;
		for (let i = 0; i < list.length; i += IMPORT_CHUNK) {
			const part = list.slice(i, i + IMPORT_CHUNK);
			chain = chain.then(() => post({action: ACTIONS.importExt, subsidiary, sourceSystem: system, importBatch: batch, dryRun, rows: part.map((r) => importPayloadRow(r, batch))}).then((r) => out.push({response: r || {}, rows: part})));
		}
		return app.run(dryRun ? t.imp.checking : t.imp.writing(list.length), chain.then(() => out));
	};
	const checkImport = () => {
		const v = impRef.current;
		if (!str(v.system).trim()) {
			patchImp({systemError: t.imp.errSystem});
			return;
		}
		const good = v.rows.filter((r) => !r.errors.length);
		if (!good.length) {
			patchImp({results: {}, systemError: '', message: t.imp.checked(0, v.rows.length)});
			return;
		}
		sendImport(good, true).then((responses) => {
			if (!responses || !alive.current || impRef.current !== v) return;
			const next = Object.assign({}, v, {results: mapImportResults(responses), systemError: ''});
			const shown = importView(next);
			const bad = shown.filter((r) => r.status === 'error').length;
			putImp(Object.assign(next, {message: t.imp.checked(shown.length - bad, bad)}));
		});
	};
	const writeImport = () => {
		const v = impRef.current;
		const shown = importView(v);
		const ok = shown.filter((r) => r.status === 'ok');
		const bad = shown.length - ok.length;
		const go = () =>
			sendImport(ok, false).then((responses) => {
				if (!responses || !alive.current) return;
				const res = mapImportResults(responses);
				const failed = Object.keys(res).filter((k) => res[k].status === 'error');
				if (failed.length && impRef.current) {
					putImp(Object.assign({}, impRef.current, {results: Object.assign({}, impRef.current.results, res), message: t.imp.checked(ok.length - failed.length, bad + failed.length)}));
					return;
				}
				const counted = responses.some((p) => has(rd(p.response, 'written', 'saved')));
				const n = counted ? responses.reduce((acc, p) => acc + (numv(rd(p.response, 'written', 'saved')) || 0), 0) : ok.length;
				putImp(null);
				if (tab === 'ext') loadExt().then(() => alive.current && app.notify(t.imp.written(n), 'ok'));
				else {
					setExt(null);
					app.notify(t.imp.written(n), 'ok');
				}
			});
		if (bad) app.confirm(t.imp.confirmSkip(ok.length, bad), go);
		else go();
	};
	const downloadTemplate = () => download(t.ext.templateName, templateCsv());

	// ------------------------------------------------------------------ phần vẽ dùng chung
	const line = (label, value, strong) => (
		<div class={strong ? 's4vp-line s4vp-cm-strong' : 's4vp-line'}>
			<span class="s4vp-muted">{label}</span>
			<span class="s4vp-cm-val">{value}</span>
		</div>
	);
	const stepList = (steps, label) =>
		steps.length ? (
			<ol class="s4vp-cm-steps" aria-label={label}>
				{steps.map((x, i) => (
					<li key={`st${i}`}>{localized(x)}</li>
				))}
			</ol>
		) : (
			<Empty text={t.side.noSteps} />
		);
	const methodText = (m) => (t.method[m] ? `${m} - ${t.method[m]}` : m);
	const componentTable = (components, basis) => (
		<div class="s4vp-cm-box">
			<Table
				label={t.side.components}
				columns={[
					{key: 'name', label: t.side.compCols.name},
					{key: 'methodText', label: t.side.compCols.method, nowrap: true},
					{key: 'base', label: t.side.compCols.base, type: basis === 'Q' ? 'num' : 'money', nowrap: true},
					{key: 'amount', label: t.side.compCols.amount, type: 'money', nowrap: true},
				]}
				rows={components.map((c) => Object.assign({}, c, {id: c.key, methodText: methodText(c.method)}))}
				total={components.length > 1 ? {name: '', amount: sumBy(components, 'amount')} : null}
				empty={t.side.noSteps}
			/>
		</div>
	);

	// ------------------------------------------------------------------ tab Bảng tính
	const kpis = view ? view.kpis : {};
	const statCards = [
		{key: 'base', label: t.kpi.base, value: money(kpis.totalBase) || '0', note: t.kpi.baseNote},
		{key: 'amount', label: t.kpi.amount, value: money(kpis.totalAmount) || '0', note: t.kpi.amountNote(kpis.warnings || 0), tone: kpis.warnings ? 'warn' : run && run.status === 'A' ? 'ok' : ''},
		{key: 'emp', label: t.kpi.employees, value: num(kpis.employees || 0) || '0', note: t.kpi.employeesNote},
		{key: 'att', label: t.kpi.attainment, value: kpis.avgAttainment === null || kpis.avgAttainment === undefined ? '-' : pctText(kpis.avgAttainment), note: t.kpi.attainmentNote},
	];
	const gridRows = rows.map((r) => Object.assign({}, r, {attainmentText: pctText(r.attainment)}));
	const gridTotal = gridRows.length > 1 ? {code: t.total(gridRows.length), base: sumBy(gridRows, 'base'), earned: sumBy(gridRows, 'earned'), override: sumBy(gridRows, 'override'), adjustments: sumBy(gridRows, 'adjustments'), payable: sumBy(gridRows, 'payable')} : null;
	const anyOverride = gridRows.some((r) => r.override);
	const anyCapped = gridRows.some((r) => r.capped);
	const anyDraw = gridRows.some((r) => r.drawPaid);
	const gridColumns = [
		{key: 'code', label: t.cols.code, nowrap: true, render: (r) => <span class="s4vp-link">{r.code || r.employee}</span>},
		{key: 'name', label: t.cols.name, render: (r) => (
			<span class="s4vp-cm-who">
				<span class="s4vp-cm-who-n">{r.name}</span>
				{r.department ? <span class="s4vp-small">{r.department}</span> : null}
			</span>
		)},
		{key: 'planName', label: t.cols.plan, nowrap: true, render: (r) => <span class="s4vp-cm-clip" title={r.planName}>{r.planName || r.plan}</span>},
		{key: 'quota', label: t.cols.quota, type: 'money', nowrap: true},
		{key: 'base', label: t.cols.base, type: 'money', nowrap: true},
		{key: 'attainment', label: t.cols.attainment, align: 'right', nowrap: true, render: (r) => r.attainmentText},
		{key: 'earned', label: t.cols.earned, type: 'money', nowrap: true},
		anyOverride ? {key: 'override', label: t.cols.override, type: 'money', nowrap: true} : null,
		{key: 'adjustments', label: t.cols.adjustments, type: 'money', nowrap: true},
		anyCapped ? {key: 'capped', label: t.cols.capped, type: 'money', nowrap: true} : null,
		anyDraw ? {key: 'drawPaid', label: t.cols.drawPaid, type: 'money', nowrap: true} : null,
		{key: 'payable', label: t.cols.payable, type: 'money', nowrap: true, render: (r) => <b>{money(r.payable)}</b>},
		{key: 'warnings', label: t.cols.warnings, align: 'center', nowrap: true, render: (r) => (r.warnings ? <Badge text={String(r.warnings)} tone="warn" /> : '')},
	];

	const explainTab = (row, d) => {
		const sm = t.side.summary;
		const moneyOrNum = (v) => (d.basis === 'Q' ? num(v) : money(v));
		return (
			<div class="s4vp-cm-body">
				{d.warnings.length ? (
					<div class="s4vp-cm-warn" role="note">
						<b>{t.side.warnings}</b>
						{d.warnings.map((w, i) => (
							<span key={`w${i}`}>{localized(w) || w.code}</span>
						))}
					</div>
				) : null}
				<div class="s4vp-cm-info">
					{d.quota !== null ? line(sm.quota, money(d.quota)) : null}
					{line(sm.base, moneyOrNum(d.base !== null ? d.base : row.base))}
					{d.windowBase !== null && d.windowBase !== d.base ? line(sm.windowBase, moneyOrNum(d.windowBase)) : null}
					{line(sm.attainment, pctText(d.attainment !== null ? d.attainment : row.attainment) || '-')}
					{d.gross !== null && d.priorPaid ? line(sm.gross, money(d.gross)) : null}
					{d.priorPaid ? line(sm.priorPaid, money(-d.priorPaid)) : null}
					{line(sm.earned, money(d.earned !== null ? d.earned : row.earned) || '0')}
					{d.override ? line(sm.override, money(d.override)) : null}
					{d.adjustments ? line(sm.adjustments, money(d.adjustments)) : null}
					{d.capped ? line(sm.capped, money(-d.capped)) : null}
					{d.drawPaid ? line(sm.drawPaid, money(d.drawPaid)) : null}
					{d.drawRecovered ? line(sm.drawRecovered, money(-d.drawRecovered)) : null}
					{d.drawBalance ? line(sm.drawBalance, money(d.drawBalance)) : null}
					{line(sm.payable, money(d.payable !== null ? d.payable : row.payable) || '0', true)}
				</div>
				{d.components.length ? <div class="s4vp-cm-sub">{t.side.components}</div> : null}
				{d.components.length ? componentTable(d.components, d.basis) : null}
				<div class="s4vp-cm-sub">{t.side.steps}</div>
				{stepList(d.steps, t.side.steps)}
			</div>
		);
	};
	const creditsTab = (d) => {
		const c = t.side.credit;
		const isNs = (src) => !src || ['N', 'NS', 'NETSUITE'].indexOf(src.toUpperCase()) >= 0;
		const list = d.credits.map((x) => Object.assign({}, x, {typeText: t.tranType[x.tranType] || x.tranType, pctText: pctText(x.pct), sourceText: isNs(x.source) ? t.netsuite : x.source, external: !isNs(x.source)}));
		return (
			<div class="s4vp-cm-box">
				<Table
					label={t.side.credits}
					columns={[
						{key: 'tranNo', label: c.tranNo, nowrap: true, render: (x) => (
							<span class="s4vp-cm-who">
								<span class={x.tranId ? 's4vp-link' : ''}>{x.tranNo || x.tranId}</span>
								<span class="s4vp-small">{x.typeText}</span>
							</span>
						)},
						{key: 'date', label: c.date, type: 'date', nowrap: true},
						{key: 'sourceText', label: c.source, nowrap: true, render: (x) => (x.external ? <Badge text={x.sourceText} tone="info" /> : <span class="s4vp-small">{x.sourceText}</span>)},
						{key: 'customer', label: c.customer, render: (x) => <span class="s4vp-cm-clip" title={x.customer}>{x.customer}</span>},
						{key: 'item', label: c.item, render: (x) => <span class="s4vp-cm-clip" title={x.item}>{x.item}</span>},
						{key: 'pct', label: c.pct, align: 'right', nowrap: true, render: (x) => x.pctText},
						{key: 'base', label: c.base, type: d.basis === 'Q' ? 'num' : 'money', nowrap: true},
					]}
					rows={list}
					onRowClick={(x) => !x.external && x.tranId && TRAN_RECORD[x.tranType] && openRecord(TRAN_RECORD[x.tranType], x.tranId)}
					total={list.length > 1 ? {tranNo: '', base: sumBy(list, 'base')} : null}
					empty={c.empty}
					search={true}
					searchPlaceholder={c.search}
					maxHeight="max(220px, calc(100vh - 470px))"
				/>
			</div>
		);
	};
	const sharesTab = (d) => {
		const c = t.side.share;
		return (
			<div class="s4vp-cm-box">
				<Table
					label={t.side.shares}
					columns={[
						{key: 'department', label: c.department},
						{key: 'cls', label: c.cls},
						{key: 'location', label: c.location},
						{key: 'project', label: c.project},
						{key: 'amount', label: c.amount, type: 'money', nowrap: true},
					]}
					rows={d.shares}
					total={d.shares.length > 1 ? {department: '', amount: sumBy(d.shares, 'amount')} : null}
					empty={c.empty}
					search={true}
					searchPlaceholder={c.search}
				/>
			</div>
		);
	};
	const adjustTab = (row, d) => {
		const c = t.side.adj;
		const e = adj.errors || {};
		const mine = rows.filter((r) => r.employee === row.employee);
		const planOpts = mine.map((r) => ({value: r.plan, label: r.planName || r.plan})).concat(plans.map((p) => ({value: p.id, label: p.name}))).filter((o, i, a) => o.value && a.findIndex((x) => x.value === o.value) === i);
		const disabledWhy = !canWrite ? t.readOnly : adjLocked ? c.locked : '';
		const list = d ? d.adjustList.map((x) => Object.assign({}, x, {planText: x.planName || labelOf(planOpts, x.plan)})) : [];
		return (
			<div class="s4vp-cm-body">
				<div class="s4vp-cm-sub">{c.add}</div>
				{disabledWhy ? <div class="s4vp-cm-note" role="note">{disabledWhy}</div> : null}
				<div class="s4vp-cm-adj">
					<Field label={c.plan} required={true} hint={e.plan ? <span class="s4vp-cm-err">{e.plan}</span> : null}>
						<Select value={adj.plan || row.plan} options={planOpts} onInput={(v) => putAdj({plan: v})} disabled={!!disabledWhy} />
					</Field>
					<Field label={c.amount} required={true} hint={e.amount ? <span class="s4vp-cm-err">{e.amount}</span> : c.amountHint}>
						<MoneyInput value={adj.amount} decimals={0} onInput={(v) => putAdj({amount: v})} disabled={!!disabledWhy} />
					</Field>
				</div>
				<Field label={c.reason} required={true} hint={e.reason ? <span class="s4vp-cm-err">{e.reason}</span> : null}>
					<TextArea value={adj.reason} rows={2} onInput={(v) => putAdj({reason: v})} disabled={!!disabledWhy} />
				</Field>
				<div class="s4vp-actions">
					<Button label={c.save} kind="primary" disabled={!!disabledWhy || !!app.busy} title={disabledWhy} onClick={() => saveAdjust(row)} />
				</div>
				<div class="s4vp-cm-sub">{c.list}</div>
				<div class="s4vp-cm-box">
					<Table
						label={c.list}
						columns={[
							{key: 'date', label: c.cols.date, type: 'date', nowrap: true},
							{key: 'planText', label: c.cols.plan, nowrap: true},
							{key: 'amount', label: c.cols.amount, type: 'money', nowrap: true},
							{key: 'reason', label: c.cols.reason},
							{key: 'by', label: c.cols.by, nowrap: true},
						]}
						rows={list}
						total={list.length > 1 ? {date: '', amount: sumBy(list, 'amount')} : null}
						empty={c.empty}
						search={true}
						searchPlaceholder={c.search}
					/>
				</div>
			</div>
		);
	};
	const detailPanel = (row) => {
		const st = detailsRef.current[row.resultId] || details[row.resultId] || null;
		const d = st && st.state === 'ok' ? st.data : null;
		let body = null;
		if (!row.resultId) body = <Empty text={t.side.failed} />;
		else if (!st || st.state === 'loading') body = <Empty text={t.side.loading} />;
		else if (st.state === 'error')
			body = (
				<div class="s4vp-cm-body">
					<div class="s4vp-cm-warn s4vp-cm-bad" role="alert">{`${t.side.failed} ${st.error || ''}`}</div>
					<div>
						<Button label={t.side.retry} onClick={() => loadDetail(row.resultId)} />
					</div>
				</div>
			);
		else if (sideTab === 'credits') body = creditsTab(d);
		else if (sideTab === 'shares') body = sharesTab(d);
		else if (sideTab !== 'adjust') body = explainTab(row, d);
		if (sideTab === 'adjust') body = adjustTab(row, d);
		const tabs = [
			{value: 'explain', label: t.side.explain},
			{value: 'credits', label: t.side.credits, count: d ? d.credits.length : null},
			{value: 'shares', label: t.side.shares, count: d ? d.shares.length : null},
			{value: 'adjust', label: t.side.adjust, count: d && d.adjustList.length ? d.adjustList.length : null},
		];
		return (
			<SidePanel title={`${row.code} ${row.name}`.trim() || row.employee} sub={[row.planName, row.department].filter(Boolean).join(' · ')}>
				<Tabs items={tabs} value={sideTab} onPick={setSideTab} label={t.side.label} />
				{body}
			</SidePanel>
		);
	};

	// Cảnh báo cấp bảng tính: doanh số chưa ai được ghi nhận (người bán chưa phân công, chứng từ không có người bán)
	const runWarns = run && run.warnings ? run.warnings : [];
	const runTab = () => (
		<div class="s4vp-cm">
			<StatCards cards={statCards} />
			{runWarns.length ? (
				<div class="s4vp-cm-warn" role="note">
					<b>{t.run.runWarnings}</b>
					{runWarns.map((w, i) => (
						<span key={`rw${i}`}>{localized(w) || w.code}</span>
					))}
				</div>
			) : null}
			<div class="s4vp-cols">
				<div class="s4vp-col-main">
					<Card flush={true} label={t.tabs.run}>
						<Table
							label={t.tabs.run}
							columns={gridColumns}
							rows={gridRows}
							keyOf={(r) => r.id}
							onRowClick={(r) => setSelected(r.id)}
							selectedKey={current ? current.id : ''}
							total={gridTotal}
							empty={t.empty}
							search={true}
							searchPlaceholder={t.search}
							maxHeight="max(260px, calc(100vh - 384px))"
						/>
					</Card>
				</div>
				<div class="s4vp-col-side s4vp-cm-side">{current ? detailPanel(current) : <SidePanel title={t.side.label}><Empty text={t.side.pick} /></SidePanel>}</div>
			</div>
		</div>
	);

	// ------------------------------------------------------------------ tab Kế hoạch
	const planState = (p) => {
		if (p.inactive) return {text: t.plans.inactive, tone: 'muted'};
		if (p.expiration && p.expiration < localToday()) return {text: t.plans.expired, tone: 'warn'};
		return {text: t.plans.active, tone: 'ok'};
	};
	const planListTab = () => {
		const list = plans.map((p) => {
			const stt = planState(p);
			return {
				id: p.id || p.key,
				plan: p,
				name: p.name,
				description: p.description,
				basisText: t.basis[p.basis] || p.basis,
				sourceText: t.source[p.source] || p.source,
				windowText: t.window[p.window] || p.window,
				components: p.rules.length,
				assignees: p.assignments.length,
				rangeText: t.plans.range(fmtDate(p.effective), fmtDate(p.expiration)),
				earningText: labelOf(earningOptions, p.earningType),
				stateText: stt.text,
				tone: stt.tone,
			};
		});
		return (
			<Card flush={true} label={t.tabs.plans}>
				<Table
					label={t.tabs.plans}
					columns={[
						{key: 'name', label: t.plans.cols.name, nowrap: true, render: (r) => <span class="s4vp-link">{r.name || r.id}</span>},
						{key: 'description', label: t.plans.cols.description, render: (r) => <span class="s4vp-cm-clip" title={r.description}>{r.description}</span>},
						{key: 'sourceText', label: t.plans.cols.source, nowrap: true},
						{key: 'basisText', label: t.plans.cols.basis, nowrap: true},
						{key: 'windowText', label: t.plans.cols.window, nowrap: true},
						{key: 'components', label: t.plans.cols.components, type: 'num', nowrap: true},
						{key: 'assignees', label: t.plans.cols.assignees, type: 'num', nowrap: true},
						{key: 'rangeText', label: t.plans.cols.effective, nowrap: true},
						{key: 'earningText', label: t.plans.cols.earningType, nowrap: true},
						{key: 'stateText', label: t.plans.cols.state, nowrap: true, render: (r) => <Badge text={r.stateText} tone={r.tone} />},
					]}
					rows={list}
					onRowClick={(r) => openPlan(r.plan)}
					empty={t.plans.empty}
					search={true}
					searchPlaceholder={t.plans.search}
					maxHeight="max(260px, calc(100vh - 300px))"
				/>
			</Card>
		);
	};

	const errText = (code) => (code ? t.plans.err[code] || code : '');
	const fieldErr = (k) => {
		const code = errs && errs.plan[k];
		return code ? <span class="s4vp-cm-err">{errText(code)}</span> : null;
	};
	const multiPick = (label, options, values, onChange) => {
		const chosen = idList(values);
		const left = options.filter((o) => chosen.indexOf(o.value) < 0);
		return (
			<Field label={label}>
				<div class="s4vp-cm-chips">
					{chosen.map((id) => {
						const name = labelOf(options, id);
						return (
							<span key={`c${id}`} class="s4vp-cm-chip">
								<span>{name}</span>
								<button type="button" class="s4vp-cm-chip-x" aria-label={t.plans.rule.removeChip(name)} title={t.plans.rule.removeChip(name)} onClick={() => onChange(chosen.filter((x) => x !== id))}>
									{'×'}
								</button>
							</span>
						);
					})}
					<span class="s4vp-cm-chip-add">
						<SearchSelect value="" options={left} placeholder={t.plans.rule.add} ariaLabel={label} onInput={(v) => v && onChange(chosen.concat([v]))} />
					</span>
				</div>
			</Field>
		);
	};
	// Ô chip cho danh sách chữ tự do (mã hàng, nhóm hàng): chip có nút bỏ + ô gõ (trình nghe gốc ở tokenFns) + nút Thêm
	const tokenInput = (id, label, hint, values, onChange) => {
		const list = tokenList(values);
		tokenFns.current[id] = {add: (text) => onChange(addTokens(list, text)), pop: () => list.length && onChange(list.slice(0, -1))};
		const addTyped = () => {
			try {
				const el = document.getElementById(id);
				if (el && str(el.value).trim()) {
					const text = el.value;
					el.value = '';
					onChange(addTokens(list, text));
				}
			} catch (e) {
				// bỏ qua
			}
		};
		return (
			<Field label={label} hint={hint}>
				<div class="s4vp-cm-chips">
					{list.map((v) => (
						<span key={`k${v}`} class="s4vp-cm-chip">
							<span>{v}</span>
							<button type="button" class="s4vp-cm-chip-x" aria-label={t.plans.rule.removeChip(v)} title={t.plans.rule.removeChip(v)} onClick={() => onChange(list.filter((x) => x !== v))}>
								{'×'}
							</button>
						</span>
					))}
					<span class="s4vp-cm-chip-add">
						<input id={id} type="text" class="s4vp-in" placeholder={t.plans.rule.tokenPh} aria-label={label} autocomplete="off" disabled={!canWrite} />
					</span>
					<Button small={true} kind="ghost" label={t.plans.rule.add} ariaLabel={`${t.plans.rule.add} ${label}`} disabled={!canWrite} onClick={addTyped} />
				</div>
			</Field>
		);
	};
	const typeOptions = ITEM_TYPES.map((c) => ({value: c, label: `${t.itemType[c] || c} (${c})`}));
	// Tóm tắt bộ lọc cho cột Bộ lọc của lưới thành phần: loại, mã, nhóm (2 giá trị đầu + số còn lại), phạm vi khách, số điều kiện id
	const shortList = (list, label) => (list.length > 2 ? `${list.slice(0, 2).map(label).join(', ')} +${list.length - 2}` : list.map(label).join(', '));
	const filterSummary = (r) => {
		const sm = t.plans.sum;
		const parts = [];
		const types = idList(r.fItemTypes);
		const codes = tokenList(r.fItemCodes);
		const groups = tokenList(r.fItemGroups);
		if (types.length) parts.push(sm.types(shortList(types, (c) => t.itemType[c] || c)));
		if (codes.length) parts.push(sm.codes(shortList(codes, (x) => x)));
		if (groups.length) parts.push(sm.groups(shortList(groups, (x) => x)));
		const days = toNumber(r.newDays) || 90;
		if (r.customerScope === 'N') parts.push(sm.scopeN(days));
		if (r.customerScope === 'E') parts.push(sm.scopeE(days));
		const others = FILTER_KEYS.concat([{key: 'fItems'}]).reduce((n, k) => n + idList(r[k.key]).length, 0);
		if (others) parts.push(parts.length ? sm.others(others) : t.plans.filtersCount(others));
		return parts.length ? parts.join('; ') : t.plans.filtersCount(0);
	};
	const planForm = (d) => {
		const f = t.plans.f;
		const subs = arr(boot.subsidiaries).map((x) => ({value: str(x.id), label: str(x.name)}));
		return (
			<Card title={t.plans.form} sub={d.dirty ? <span class="s4vp-cm-dirty">{t.plans.dirty}</span> : null}>
				<div class="s4vp-form s4vp-cm-form">
					<Field label={f.name} required={true} hint={fieldErr('name')}>
						<TextInput value={d.name} onInput={setPlanField('name')} />
					</Field>
					<Field label={f.description}>
						<TextInput value={d.description} onInput={setPlanField('description')} />
					</Field>
					<Field label={f.subsidiary}>
						<AutoSelect value={d.subsidiary} options={subs} placeholder={f.allSubs} onInput={setPlanField('subsidiary')} />
					</Field>
					<Field label={f.earningType} required={true} hint={fieldErr('earningType')}>
						<SearchSelect value={d.earningType} options={earningOptions} onInput={setPlanField('earningType')} ariaLabel={f.earningType} />
					</Field>
					<Field label={f.effective}>
						<DateInput value={d.effective} onInput={setPlanField('effective')} />
					</Field>
					<Field label={f.expiration} hint={fieldErr('expiration')}>
						<DateInput value={d.expiration} min={d.effective || ''} onInput={setPlanField('expiration')} />
					</Field>
					<Field label={f.source} hint={d.source !== 'N' ? f.sourceHint : null}>
						<Select value={d.source} options={opts(SOURCES, t.source)} onInput={setPlanField('source')} />
					</Field>
					<Field label={f.basis}>
						<Select value={d.basis} options={opts(BASIS, t.basis)} onInput={setPlanField('basis')} />
					</Field>
					<Field label={f.trigger}>
						<Select value={d.trigger} options={opts(TRIGGERS, t.trigger)} onInput={setPlanField('trigger')} />
					</Field>
					<Field label={f.creditSource}>
						<Select value={d.creditSource} options={opts(CREDITS, t.credit)} onInput={setPlanField('creditSource')} />
					</Field>
					{d.creditSource === 'F' ? (
						<Field label={f.creditField} required={true} hint={fieldErr('creditField') || f.creditFieldHint}>
							<TextInput value={d.creditField} onInput={setPlanField('creditField')} />
						</Field>
					) : null}
					<Field label={f.window}>
						<Select value={d.window} options={opts(WINDOWS, t.window)} onInput={setPlanField('window')} />
					</Field>
					<Field label={f.clawbackDays} hint={f.clawbackHint}>
						<NumberInput value={d.clawbackDays} min={0} step={1} disabled={d.trigger !== 'I'} onInput={setPlanField('clawbackDays')} />
					</Field>
					<Field label={f.excludeItemTypes} hint={f.excludeHint}>
						<TextInput value={d.excludeItemTypes} onInput={setPlanField('excludeItemTypes')} />
					</Field>
					<Field label={f.itemGroupField} hint={fieldErr('itemGroupField') || f.itemGroupFieldHint}>
						<TextInput value={d.itemGroupField} placeholder="custitem_..." onInput={setPlanField('itemGroupField')} />
					</Field>
					<Field label={f.minAttainment} hint={f.minHint}>
						<NumberInput value={d.minAttainment} min={0} step={0.01} onInput={setPlanField('minAttainment')} />
					</Field>
					<Field label={f.capAmount} hint={f.capHint}>
						<MoneyInput value={d.capAmount} decimals={0} onInput={setPlanField('capAmount')} />
					</Field>
					<Field label={f.drawType}>
						<Select value={d.drawType} options={opts(DRAWS, t.draw)} onInput={setPlanField('drawType')} />
					</Field>
					<Field label={f.drawAmount} required={d.drawType !== 'N'} hint={fieldErr('drawAmount')}>
						<MoneyInput value={d.drawAmount} decimals={0} disabled={d.drawType === 'N'} onInput={setPlanField('drawAmount')} />
					</Field>
					<Field label={f.overridePct} hint={f.overrideHint}>
						<NumberInput value={d.overridePct} min={0} max={100} step={0.01} onInput={setPlanField('overridePct')} />
					</Field>
					<Field label={f.overrideBasis}>
						<Select value={d.overrideBasis} options={opts(OVERRIDES, t.overrideBasis)} onInput={setPlanField('overrideBasis')} />
					</Field>
					<Field label={f.includeReturns}>
						<Checkbox checked={!!d.includeReturns} inField={true} label={f.includeReturns} ariaLabel={f.includeReturns} onInput={setPlanField('includeReturns')} />
					</Field>
				</div>
				{errs && errs.plan.rules ? <div class="s4vp-cm-err">{errText(errs.plan.rules)}</div> : null}
			</Card>
		);
	};
	const ruleValueText = (r) => {
		if (r.method === 'P') return has(r.rate) ? pctText(toNumber(r.rate)) : '';
		if (r.method === 'U') return has(r.unitAmount) ? money(toNumber(r.unitAmount)) : '';
		return t.plans.tiersCount(r.tiers.length);
	};
	const rulesGrid = (d) => {
		const list = d.rules.map((r) => Object.assign({}, r, {id: r.key, methodText: methodText(r.method), valueText: ruleValueText(r), filterText: filterSummary(r)}));
		const ruleErr = errs ? errs.rules : {};
		return (
			<Card flush={true} title={t.plans.rules} actions={[<Button label={t.plans.addRule} kind="dashed" small={true} disabled={!canWrite} onClick={addRule} />]}>
				<Table
					label={t.plans.rules}
					columns={[
						{key: 'sequence', label: t.plans.ruleCols.sequence, type: 'num', nowrap: true},
						{key: 'name', label: t.plans.ruleCols.name, render: (r) => (
							<span class="s4vp-cm-who">
								<span class="s4vp-link">{r.name || '-'}</span>
								{ruleErr[r.key] ? <span class="s4vp-cm-err">{errText(ruleErr[r.key])}</span> : null}
							</span>
						)},
						{key: 'methodText', label: t.plans.ruleCols.method, nowrap: true},
						{key: 'valueText', label: t.plans.ruleCols.value, align: 'right', nowrap: true},
						{key: 'filterText', label: t.plans.ruleCols.filters, render: (r) => <span class="s4vp-cm-clip" title={r.filterText}>{r.filterText}</span>},
						{key: 'remove', label: '', noRowClick: true, render: (r) => <Button small={true} kind="ghost" label={t.plans.remove} ariaLabel={t.plans.removeOf(r.name)} disabled={!canWrite} onClick={() => removeRule(r.key)} />},
					]}
					rows={list}
					keyOf={(r) => r.key}
					onRowClick={(r) => setRuleKey(r.key)}
					selectedKey={ruleKey}
					empty={t.plans.rulesEmpty}
					search={true}
					searchPlaceholder={t.plans.rulesSearch}
				/>
			</Card>
		);
	};
	const ruleEditor = (d) => {
		const r = d.rules.find((x) => x.key === ruleKey);
		const c = t.plans.rule;
		if (!r)
			return (
				<SidePanel title={t.plans.rules}>
					<Empty text={c.pick} />
				</SidePanel>
			);
		const tiered = TIER_METHODS.indexOf(r.method) >= 0;
		const fromPct = tierFromIsPct(r.method);
		const ruleErrCode = errs ? errs.rules[r.key] || '' : '';
		const err = ruleErrCode ? <span class="s4vp-cm-err">{errText(ruleErrCode)}</span> : null;
		return (
			<SidePanel title={c.title(r.name || '-')} sub={methodText(r.method)}>
				{err ? <div>{err}</div> : null}
				<div class="s4vp-cm-pair">
					<Field label={c.name} required={true}>
						<TextInput value={r.name} onInput={(v) => setRule(r.key, {name: v})} />
					</Field>
					<Field label={c.sequence}>
						<NumberInput value={r.sequence} min={0} step={1} onInput={(v) => setRule(r.key, {sequence: v})} />
					</Field>
				</div>
				<Field label={c.method} required={true}>
					<Select value={r.method} options={METHODS.map((m) => ({value: m, label: methodText(m)}))} onInput={(v) => setRule(r.key, {method: v})} />
				</Field>
				<dl class="s4vp-cm-methods" aria-label={c.methods}>
					{METHODS.map((m) => (
						<div key={`m${m}`} class={m === r.method ? 's4vp-cm-method s4vp-on' : 's4vp-cm-method'}>
							<dt>{`${m} - ${t.method[m]}`}</dt>
							<dd>{t.methodHelp[m]}</dd>
						</div>
					))}
				</dl>
				{r.method === 'P' ? (
					<Field label={c.rate} required={true}>
						<NumberInput value={r.rate} min={0} max={100} step={0.01} onInput={(v) => setRule(r.key, {rate: v})} />
					</Field>
				) : null}
				{r.method === 'U' ? (
					<Field label={c.unitAmount} required={true}>
						<MoneyInput value={r.unitAmount} decimals={0} onInput={(v) => setRule(r.key, {unitAmount: v})} />
					</Field>
				) : null}
				<div class="s4vp-cm-sub">{c.tiers}</div>
				{tiered ? (
					<div class="s4vp-cm-box s4vp-cm-edit">
						<Table
							label={c.tiers}
							columns={[
								{key: 'fromValue', label: fromPct ? c.tierFromPct : c.tierFromMoney, align: 'right', render: (x) => (fromPct ? <NumberInput value={x.fromValue} min={0} step={0.01} ariaLabel={c.tierFromPct} onInput={(v) => setTier(r.key, x.key, {fromValue: v})} /> : <MoneyInput value={x.fromValue === '' ? '' : toNumber(x.fromValue)} decimals={0} ariaLabel={c.tierFromMoney} onInput={(v) => setTier(r.key, x.key, {fromValue: v})} />)},
								r.method === 'B'
									? {key: 'amount', label: c.tierAmount, align: 'right', render: (x) => <MoneyInput value={x.amount} decimals={0} ariaLabel={c.tierAmount} onInput={(v) => setTier(r.key, x.key, {amount: v})} />}
									: {key: 'rate', label: c.tierRate, align: 'right', render: (x) => <NumberInput value={x.rate} min={0} max={100} step={0.01} ariaLabel={c.tierRate} onInput={(v) => setTier(r.key, x.key, {rate: v})} />},
								{key: 'remove', label: '', render: (x) => <Button small={true} kind="ghost" label={t.plans.remove} onClick={() => removeTier(r.key, x.key)} />},
							]}
							rows={r.tiers.map((x) => Object.assign({}, x, {id: x.key}))}
							keyOf={(x) => x.key}
							empty={c.tiersEmpty}
							search={true}
							toolbar={<Button label={c.addTier} kind="dashed" small={true} onClick={() => addTier(r.key)} />}
						/>
						<div class="s4vp-small s4vp-cm-pad">{c.tierOrder}</div>
					</div>
				) : (
					<div class="s4vp-small">{c.noTiers}</div>
				)}
				<div class="s4vp-cm-sub">{c.filters}</div>
				{FILTER_KEYS.map((fk) => (
					<div key={fk.key}>{multiPick(c[fk.label], lookups[fk.lookup], r[fk.key], (v) => setRule(r.key, {[fk.key]: v}))}</div>
				))}
				{lookups.items.length ? (
					multiPick(c.items, lookups.items, r.fItems, (v) => setRule(r.key, {fItems: v}))
				) : (
					<Field label={c.items} hint={c.itemsHint}>
						<TextInput value={idList(r.fItems).join(',')} onInput={(v) => setRule(r.key, {fItems: v})} />
					</Field>
				)}
				{multiPick(c.itemTypes, typeOptions, r.fItemTypes, (v) => setRule(r.key, {fItemTypes: v}))}
				{tokenInput('s4vp-cm-tok-codes', c.itemCodes, c.itemCodesHint, r.fItemCodes, (v) => setRule(r.key, {fItemCodes: v}))}
				{tokenInput('s4vp-cm-tok-groups', c.itemGroups, ruleErrCode === 'noGroupField' ? err : c.itemGroupsHint(str(d.itemGroupField).trim()), r.fItemGroups, (v) => setRule(r.key, {fItemGroups: v}))}
				<div class="s4vp-cm-pair">
					<Field label={c.customerScope}>
						<Select value={r.customerScope || 'A'} options={opts(CUSTOMER_SCOPES, t.scope)} ariaLabel={c.customerScope} onInput={(v) => setRule(r.key, {customerScope: v})} />
					</Field>
					{r.customerScope === 'N' || r.customerScope === 'E' ? (
						<Field label={c.newDays} required={true} hint={ruleErrCode === 'newDays' ? err : null}>
							<NumberInput value={r.newDays} min={1} step={1} onInput={(v) => setRule(r.key, {newDays: v})} />
						</Field>
					) : null}
				</div>
				{r.customerScope === 'N' || r.customerScope === 'E' ? <div class="s4vp-small s4vp-cm-pad">{c.scopeHelp(toNumber(r.newDays) || 90)}</div> : null}
			</SidePanel>
		);
	};
	const assignGrid = (d) => {
		const c = t.plans.assignCols;
		const aErr = errs ? errs.assignments : {};
		const list = d.assignments.map((a) => Object.assign({}, a, {id: a.key, employeeText: labelOf(employeeOptions, a.employee), managerText: a.manager ? labelOf(employeeOptions, a.manager) : '', quotaText: money(toNumber(a.quota))}));
		return (
			<Card flush={true} title={t.plans.assign}>
				<div class="s4vp-cm-edit">
					<Table
						label={t.plans.assign}
						columns={[
							{key: 'employee', label: c.employee, width: 230, render: (a) => (
								<span class="s4vp-cm-who">
									<SearchSelect value={a.employee} options={employeeOptions} placeholder={t.plans.pickEmployee} ariaLabel={c.employee} onInput={(v) => setLine('assignments', a.key, {employee: v})} />
									{aErr[a.key] ? <span class="s4vp-cm-err">{errText(aErr[a.key])}</span> : null}
								</span>
							)},
							{key: 'effective', label: c.effective, width: 150, render: (a) => <DateInput value={a.effective} ariaLabel={c.effective} onInput={(v) => setLine('assignments', a.key, {effective: v})} />},
							{key: 'expiration', label: c.expiration, width: 150, render: (a) => <DateInput value={a.expiration} min={a.effective || ''} ariaLabel={c.expiration} onInput={(v) => setLine('assignments', a.key, {expiration: v})} />},
							{key: 'quota', label: c.quota, align: 'right', width: 150, render: (a) => <MoneyInput value={a.quota} decimals={0} ariaLabel={c.quota} onInput={(v) => setLine('assignments', a.key, {quota: v})} />},
							{key: 'manager', label: c.manager, width: 220, render: (a) => <SearchSelect value={a.manager} options={employeeOptions} placeholder={t.plans.noManager} ariaLabel={c.manager} onInput={(v) => setLine('assignments', a.key, {manager: v})} />},
							{key: 'remove', label: '', render: (a) => <Button small={true} kind="ghost" label={t.plans.remove} ariaLabel={t.plans.removeOf(a.employeeText)} onClick={() => removeLine('assignments', a.key)} />},
						]}
						rows={list}
						keyOf={(a) => a.key}
						empty={t.plans.assignEmpty}
						search={true}
						searchPlaceholder={t.plans.assignSearch}
						toolbar={<Button label={t.plans.addAssign} kind="dashed" small={true} disabled={!canWrite} onClick={addAssign} />}
					/>
				</div>
			</Card>
		);
	};
	const quotaGrid = (d) => {
		const c = t.plans.quotaCols;
		const qErr = errs ? errs.quotas : {};
		const list = d.quotas.map((q) => Object.assign({}, q, {id: q.key, employeeText: labelOf(employeeOptions, q.employee), monthText: monthText(q.month)}));
		return (
			<Card flush={true} title={t.plans.quotas} sub={t.plans.quotasHint}>
				<div class="s4vp-cm-edit">
					<Table
						label={t.plans.quotas}
						columns={[
							{key: 'employee', label: c.employee, width: 230, render: (q) => (
								<span class="s4vp-cm-who">
									<SearchSelect value={q.employee} options={employeeOptions} placeholder={t.plans.pickEmployee} ariaLabel={c.employee} onInput={(v) => setLine('quotas', q.key, {employee: v})} />
									{qErr[q.key] ? <span class="s4vp-cm-err">{errText(qErr[q.key])}</span> : null}
								</span>
							)},
							{key: 'month', label: c.month, width: 150, render: (q) => <MonthInput value={q.month} ariaLabel={c.month} onInput={(v) => setLine('quotas', q.key, {month: v})} />},
							{key: 'quota', label: c.quota, align: 'right', width: 160, render: (q) => <MoneyInput value={q.quota} decimals={0} ariaLabel={c.quota} onInput={(v) => setLine('quotas', q.key, {quota: v})} />},
							{key: 'remove', label: '', render: (q) => <Button small={true} kind="ghost" label={t.plans.remove} ariaLabel={t.plans.removeOf(q.employeeText)} onClick={() => removeLine('quotas', q.key)} />},
						]}
						rows={list}
						keyOf={(q) => q.key}
						empty={t.plans.quotasEmpty}
						search={true}
						searchPlaceholder={t.plans.quotasSearch}
						toolbar={<Button label={t.plans.addQuota} kind="dashed" small={true} disabled={!canWrite} onClick={addQuota} />}
					/>
				</div>
			</Card>
		);
	};
	const planEditor = (d) => (
		<div class="s4vp-cm">
			{errs && errs.count ? <div class="s4vp-cm-warn s4vp-cm-bad" role="alert">{t.plans.err.fix(errs.count)}</div> : null}
			{planForm(d)}
			<div class="s4vp-cols">
				<div class="s4vp-col-main">{rulesGrid(d)}</div>
				<div class="s4vp-col-side s4vp-cm-side">{ruleEditor(d)}</div>
			</div>
			{/* Phân công và chỉ tiêu tháng nhiều cột (ô chọn nhân viên, quản lý, ngày): trải hết chiều ngang để không tràn khung */}
			{assignGrid(d)}
			{quotaGrid(d)}
		</div>
	);

	// ------------------------------------------------------------------ tab Mô phỏng
	const simTab = () => {
		const c = t.sim;
		const planOpts = plans.filter((p) => p.id && !p.inactive).map((p) => ({value: p.id, label: p.description ? `${p.name} - ${p.description}` : p.name}));
		const out = simOut.data;
		const plan = plans.find((p) => p.id === sim.plan) || null;
		const quota = toNumber(sim.quota);
		const base = toNumber(sim.base);
		const localAtt = quota > 0 && base !== null ? (base / quota) * 100 : null;
		const att = out && out.attainment !== null ? out.attainment : localAtt;
		return (
			<div class="s4vp-cm">
				<div class="s4vp-cols">
					<div class="s4vp-col-side">
						<Card title={t.tabs.sim} sub={c.intro}>
							{planOpts.length ? null : <div class="s4vp-cm-note">{c.noPlans}</div>}
							<Field label={c.plan} required={true}>
								<AutoSelect value={sim.plan} options={planOpts} placeholder={c.pickPlan} onInput={setSimField('plan')} ariaLabel={c.plan} />
							</Field>
							{plan ? <div class="s4vp-small">{[t.basis[plan.basis], t.window[plan.window], plan.rules.map((r) => `${r.name} (${r.method})`).join(', ')].filter(Boolean).join(' · ')}</div> : null}
							<Field label={c.base}>
								<MoneyInput value={sim.base} decimals={0} onInput={setSimField('base')} />
							</Field>
							<Field label={c.qty}>
								<NumberInput value={sim.qty} min={0} step="any" onInput={setSimField('qty')} />
							</Field>
							<Field label={c.quota} hint={c.quotaHint}>
								<MoneyInput value={sim.quota} decimals={0} onInput={setSimField('quota')} />
							</Field>
						</Card>
					</div>
					<div class="s4vp-col-main">
						<Card title={c.result} sub={simOut.state === 'working' ? c.working : ''}>
							{simOut.state === 'error' ? <div class="s4vp-cm-warn s4vp-cm-bad" role="alert">{`${c.failed} ${simOut.error || ''}`}</div> : null}
							{out ? (
								<div class="s4vp-cm-body">
									<StatCards
										cards={[
											{key: 'amt', label: c.amount, value: money(out.amount) || '0', tone: out.amount ? 'ok' : ''},
											{key: 'att', label: c.attainment, value: att === null ? '-' : pctText(att)},
										]}
									/>
									{out.warnings.length ? (
										<div class="s4vp-cm-warn" role="note">
											{out.warnings.map((w, i) => (
												<span key={`sw${i}`}>{w && typeof w === 'object' ? localized(w) || str(w.code) : str(w)}</span>
											))}
										</div>
									) : null}
									{out.components.length ? componentTable(out.components, plan ? plan.basis : '') : null}
									<div class="s4vp-cm-sub">{t.side.steps}</div>
									{stepList(out.steps, t.side.steps)}
								</div>
							) : simOut.state === 'error' ? null : (
								<Empty text={c.waiting} />
							)}
						</Card>
					</div>
				</div>
			</div>
		);
	};

	// ------------------------------------------------------------------ tab Doanh số ngoài
	const extTab = () => {
		const c = t.ext.cols;
		const list = ext && ext.month === month && ext.sub === subsidiary ? ext.rows : [];
		const total = list.length > 1 ? {sourceSystem: t.ext.total(list.length), revenue: sumBy(list, 'revenue'), cost: sumBy(list, 'cost'), qty: sumBy(list, 'qty'), collectedAmount: sumBy(list, 'collectedAmount')} : null;
		return (
			<Card flush={true} label={t.tabs.ext}>
				<Table
					label={t.tabs.ext}
					columns={[
						{key: 'sourceSystem', label: c.source, nowrap: true, render: (x) => <Badge text={x.sourceSystem} tone="info" />},
						{key: 'docNo', label: c.docNo, nowrap: true, render: (x) => (
							<span class="s4vp-cm-who">
								<span>{x.docNo}</span>
								<span class="s4vp-small">{[t.tranType[x.tranType] || x.tranType, x.locked ? t.ext.locked : ''].filter(Boolean).join(' · ')}</span>
							</span>
						)},
						{key: 'lineNo', label: c.line, align: 'right', nowrap: true},
						{key: 'date', label: c.date, type: 'date', nowrap: true},
						{key: 'customer', label: c.customer, render: (x) => <span class="s4vp-cm-clip" title={x.customer}>{x.customer}</span>},
						{key: 'item', label: c.item, nowrap: true},
						{key: 'employee', label: c.employee, render: (x) => <span class="s4vp-cm-clip" title={x.employee}>{x.employee}</span>},
						{key: 'revenue', label: c.revenue, type: 'money', nowrap: true},
						{key: 'cost', label: c.cost, type: 'money', nowrap: true},
						{key: 'qty', label: c.qty, type: 'num', nowrap: true},
						{key: 'collectedAmount', label: c.collected, type: 'money', nowrap: true},
						{key: 'importBatch', label: c.batch, nowrap: true, render: (x) => <span class="s4vp-small">{x.importBatch}</span>},
					]}
					rows={list}
					total={total}
					empty={t.ext.empty}
					search={true}
					searchPlaceholder={t.ext.search}
					maxHeight="max(260px, calc(100vh - 300px))"
				/>
			</Card>
		);
	};
	const importDialog = () => {
		const c = t.imp;
		const v = imp;
		const shown = importView(v);
		const bad = shown.filter((r) => r.status === 'error').length;
		const ok = shown.length - bad;
		const checked = !!v.results;
		const colOpts = v.table.headers.map((h, i) => ({value: String(i), label: `${i + 1}. ${h || '-'}`}));
		const missing = IMPORT_FIELDS.filter((f) => f.required && !has(v.mapping[f.key])).map((f) => c.fields[f.key]);
		const delimText = v.table.delimiter === '\t' ? c.delim.tab : v.table.delimiter === ';' ? c.delim.semi : c.delim.comma;
		let why = '';
		if (!checked) why = c.needCheck;
		else if (!ok || (bad && !v.skip)) why = c.needFix;
		const close = () => putImp(null);
		return (
			<Dialog
				title={c.title}
				width={1120}
				onClose={close}
				actions={[
					<span class="s4vp-cm-dlg-l">
						<Button kind="link" label={t.ext.template} onClick={downloadTemplate} />
					</span>,
					<Button label={c.close} onClick={close} />,
					<Button label={c.check} kind={checked ? 'default' : 'primary'} disabled={!shown.length || missing.length > 0 || !!app.busy} onClick={checkImport} />,
					<Button label={c.write(ok)} kind={checked ? 'primary' : 'default'} disabled={!!why || !canWrite || !!app.busy} title={why} onClick={writeImport} />,
				]}
			>
				<div class="s4vp-cm-imp-top">
					<Field label={c.system} required={true} hint={v.systemError ? <span class="s4vp-cm-err">{v.systemError}</span> : c.systemHint}>
						<TextInput value={v.system} onInput={(x) => patchImp({system: x, systemError: '', results: null, message: ''})} />
					</Field>
					<Field label={c.file} hint={v.error ? <span class="s4vp-cm-err">{v.error}</span> : v.fileName || c.fileHint}>
						<input id="s4vp-cm-file" type="file" accept=".csv,.txt,text/csv,text/plain" class="s4vp-in s4vp-cm-file" />
					</Field>
				</div>
				<Field label={c.paste} hint={v.table.headers.length ? c.read(v.table.rows.length, v.table.headers.length, delimText) : c.noData}>
					<TextArea value={v.text} rows={4} placeholder={c.pastePh} onInput={(x) => setImpText(x)} ariaLabel={c.paste} />
				</Field>
				{v.table.headers.length ? (
					<div class="s4vp-cm-body">
						<div class="s4vp-cm-sub">
							{c.mapping}
							<span class="s4vp-small">{` - ${c.mappingHint}`}</span>
						</div>
						<div class="s4vp-cm-map">
							{IMPORT_FIELDS.map((f) => (
								<Field key={f.key} label={c.fields[f.key]} required={!!f.required}>
									<Select value={v.mapping[f.key] || ''} options={colOpts} placeholder={c.unused} onInput={(x) => setImpMap(f.key, x)} ariaLabel={c.fields[f.key]} />
								</Field>
							))}
						</div>
						{missing.length ? <div class="s4vp-cm-warn s4vp-cm-bad" role="alert">{c.missingReq(missing.join(', '))}</div> : null}
					</div>
				) : null}
				{shown.length ? (
					<div class="s4vp-cm-body">
						<div class="s4vp-cm-sub">
							{c.preview}
							<span class="s4vp-small">{` - ${c.counts(shown.length, checked ? ok : shown.length - shown.filter((r) => r.errors.length).length, bad)}`}</span>
						</div>
						<div class="s4vp-cm-box">
							<Table
								label={c.preview}
								columns={[
									{key: 'row', label: c.cols.row, type: 'num', nowrap: true},
									{key: 'statusText', label: c.cols.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={r.status === 'error' ? 'error' : r.status === 'ok' ? 'ok' : 'muted'} />},
									{key: 'docNo', label: c.cols.docNo, nowrap: true},
									{key: 'lineNo', label: c.cols.line, align: 'right', nowrap: true},
									{key: 'tranType', label: c.cols.type, nowrap: true},
									{key: 'date', label: c.cols.date, type: 'date', nowrap: true},
									{key: 'customerName', label: c.cols.customer, render: (r) => <span class="s4vp-cm-clip" title={r.customerName || r.customerCode}>{r.customerName || r.customerCode}</span>},
									{key: 'itemCode', label: c.cols.item, nowrap: true},
									{key: 'revenue', label: c.cols.revenue, type: 'money', nowrap: true},
									{key: 'qty', label: c.cols.qty, type: 'num', nowrap: true},
									{key: 'employeeText', label: c.cols.employee, nowrap: true},
									{key: 'errorText', label: c.cols.errors, render: (r) => (r.errorText ? <span class="s4vp-cm-err">{r.errorText}</span> : '')},
								]}
								rows={shown}
								empty={c.noData}
								search={true}
								searchPlaceholder={c.search}
								maxHeight="260px"
							/>
						</div>
						{checked && bad && ok ? <Checkbox checked={!!v.skip} label={c.skip} onInput={(x) => patchImp({skip: x})} /> : null}
						{v.message ? <div class={bad ? 's4vp-cm-warn' : 's4vp-cm-note'} role="status">{v.message}</div> : null}
					</div>
				) : null}
			</Dialog>
		);
	};

	// ------------------------------------------------------------------ khung
	const pickTab = (v) => {
		if (v === tab) return;
		if (tab === 'plans' && draftRef.current && draftRef.current.dirty)
			app.confirm(t.plans.confirmLeave, () => {
				putDraft(null);
				setErrs(null);
				setTab(v);
			});
		else setTab(v);
	};
	const reasonText = (code) => (code ? t.run.reasons[code] || '' : '');
	let actions = [];
	let status = null;
	let sub = '';
	if (!roles.canRead) sub = t.noRole;
	else if (!subsidiary) sub = t.noSubsidiary;
	else if (tab === 'run') {
		status = run ? {text: t.status[run.status] || run.status, tone: RUN_TONE[run.status] || 'muted'} : view ? {text: t.status.none, tone: 'muted'} : null;
		sub = run ? [t.run.sub(runName, fmtDate(run.from), fmtDate(run.to)), run.calcAt ? t.run.calcAt(run.calcAt.replace('T', ' ').slice(0, 16)) : ''].filter(Boolean).join(' - ') : view ? t.run.subNone(monthText(month)) : '';
		const btn = (key, label, kind, onClick) => <Button label={label} kind={kind} disabled={!acts[key].enabled || !!app.busy} title={reasonText(acts[key].reason)} onClick={onClick} />;
		actions = [
			<span class="s4vp-cm-month">
				<MonthInput value={month} onInput={(v) => /^\d{4}-\d{2}$/.test(v) && v !== month && (setSelected(''), setMonth(v))} ariaLabel={t.run.month} width={160} />
			</span>,
			run && run.batch ? <Button kind="link" label={`${t.run.batch} ${run.batchName || run.batch}`} onClick={() => app.go('payrollRun', {id: run.batch})} /> : null,
			<Button label={t.refresh} kind="ghost" onClick={() => loadView()} />,
			<Button label={t.ext.importBtn} disabled={!canWrite || !!app.busy} title={canWrite ? '' : t.readOnly} onClick={openImport} />,
			btn('void', t.run.void, 'danger', () => putVoid({id: run.id, name: runName, reason: '', error: ''})),
			btn('reopen', t.run.reopen, 'default', reopen),
			btn('approve', t.run.approve, run && run.status === 'D' ? 'primary' : 'default', approve),
			btn('calc', run && run.id ? t.run.recalc : t.run.calc, run && run.status === 'D' ? 'default' : 'primary', calculate),
		];
	} else if (tab === 'ext') {
		sub = t.ext.sub(monthText(month));
		actions = [
			<span class="s4vp-cm-month">
				<MonthInput value={month} onInput={(v) => /^\d{4}-\d{2}$/.test(v) && v !== month && (setSelected(''), setMonth(v))} ariaLabel={t.run.month} width={160} />
			</span>,
			<Button label={t.refresh} kind="ghost" onClick={() => loadExt()} />,
			<Button label={t.ext.template} kind="ghost" onClick={downloadTemplate} />,
			<Button label={t.ext.importBtn} kind="primary" disabled={!canWrite || !!app.busy} title={canWrite ? '' : t.readOnly} onClick={openImport} />,
		];
	} else if (tab === 'plans') {
		if (draft) {
			status = draft.dirty ? {text: t.plans.dirty, tone: 'warn'} : null;
			actions = [
				<Button label={t.plans.discard} kind="ghost" disabled={!draft.dirty} onClick={discardPlan} />,
				<Button label={t.plans.save} kind="primary" disabled={!canWrite || !!app.busy} title={canWrite ? '' : t.readOnly} onClick={savePlan} />,
			];
			sub = canWrite ? '' : t.readOnly;
		} else {
			actions = [<Button label={t.refresh} kind="ghost" onClick={() => loadSetup(true)} />, <Button label={t.plans.newPlan} kind="primary" disabled={!canWrite} title={canWrite ? '' : t.readOnly} onClick={() => openPlan(null)} />];
			sub = canWrite ? '' : t.readOnly;
		}
	}
	const title = tab === 'plans' && draft ? `${t.title} - ${draft.name || t.plans.newTitle}` : t.title;

	let content = null;
	if (roles.canRead && subsidiary) {
		if (tab === 'run') content = runTab();
		else if (tab === 'ext') content = extTab();
		else if (tab === 'plans') content = draft ? planEditor(draft) : planListTab();
		else content = simTab();
	}

	return (
		<Page>
			<PageHeader title={title} status={status} sub={sub} back={tab === 'plans' && draft ? {label: t.plans.backToList, onClick: leavePlan} : null} actions={actions} />
			{roles.canRead && subsidiary ? <Tabs items={SUB_TABS.map((k) => ({value: k, label: t.tabs[k]}))} value={tab} onPick={pickTab} label={t.tabs.label} /> : null}
			{content}
			{imp ? importDialog() : null}
			{voidDlg ? (
				<Dialog
					title={t.run.voidTitle(voidDlg.name)}
					width={520}
					onClose={() => putVoid(null)}
					actions={[<Button label={t.run.back} onClick={() => putVoid(null)} />, <Button label={t.run.voidRun} kind="danger" disabled={!!app.busy} onClick={submitVoid} />]}
				>
					<div class="s4vp-cm-body">
						<span>{t.run.voidIntro}</span>
						<Field label={t.run.voidReason} required={true} hint={voidDlg.error ? <span class="s4vp-cm-err">{voidDlg.error}</span> : null}>
							<TextArea value={voidDlg.reason} rows={3} onInput={(v) => putVoid(Object.assign({}, voidRef.current, {reason: v, error: ''}))} ariaLabel={t.run.voidReason} />
						</Field>
					</div>
				</Dialog>
			) : null}
		</Page>
	);
}

// Bản sao dữ liệu thô của một kế hoạch đã map (để mở biểu mẫu từ bản gốc, sửa không đụng danh sách)
function planPayloadSource(p) {
	return {
		id: p.id,
		name: p.name,
		description: p.description,
		subsidiary: p.subsidiary,
		effective: p.effective,
		expiration: p.expiration,
		source: p.source,
		basis: p.basis,
		trigger: p.trigger,
		creditSource: p.creditSource,
		creditField: p.creditField,
		window: p.window,
		includeReturns: p.includeReturns,
		clawbackDays: p.clawbackDays,
		excludeItemTypes: p.excludeItemTypes,
		earningType: p.earningType,
		minAttainment: p.minAttainment,
		capAmount: p.capAmount,
		drawType: p.drawType,
		drawAmount: p.drawAmount,
		overridePct: p.overridePct,
		overrideBasis: p.overrideBasis,
		isInactive: p.inactive,
		rules: p.rules,
		assignments: p.assignments,
		quotas: p.quotas,
	};
}
