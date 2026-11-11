/**
 * Báo cáo - tờ khai (giao diện bản 2, docs/UI_V2.md mục 14). View `reportsHub`, params: `report` (trống = danh mục), kỳ
 * (`month` yyyyMM, `year`, `quarter`, `scope` của báo cáo quỹ lương), `rel` (T = chỉ bảng đã ghi sổ), `schedule`, `c12`, `tab`.
 *
 * Người dùng vào theo hạn: danh mục xếp theo nhịp (tháng, quý, năm, bản in), mỗi mục gợi ý kỳ gần nhất có số liệu. Màn một báo
 * cáo: bộ lọc kỳ trên hàng tiêu đề, thẻ số tổng, điểm bất thường, rồi bảng (ô tìm, dòng tổng, 200 dòng mỗi trang, xuất CSV).
 * Tham số nằm trên hash nên đổi kỳ là đổi địa chỉ (quay lại được, gửi đường dẫn được); báo cáo tự tải khi tham số đổi.
 *
 * Nguồn: insurance, cost, pitq, pita gọi action cũ `report` (api/Reports); danh mục, phiếu số liệu nhập HTKK, quỹ lương theo
 * phòng ban, sổ thuế TNCN gọi route của api/ReportsHub; bản in dùng Suitelet in sẵn có qua printUrl.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, printUrl, download} from '../lib/api.js';
import {money, num, pct, localToday, toNumber, quickFilter} from '../lib/format.js';
import {pick, localized} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, StatCards, Tabs, Chips, Badge, Select, AutoSelect, MoneyInput, SearchBox, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		title: 'Báo cáo - tờ khai',
		sub: 'Chọn hồ sơ theo kỳ hạn. Mỗi mục mở sẵn kỳ gần nhất có số liệu.',
		latest: (calc, rel) => `Kỳ gần nhất đã tính lương: ${calc || 'chưa có'} - đã ghi sổ: ${rel || 'chưa có'}`,
		legacy: 'Màn hình cũ',
		back: 'Báo cáo - tờ khai',
		reload: 'Tải lại',
		open: 'Mở',
		loading: 'Đang tải...',
		waiting: 'Đang tải số liệu...',
		noSubsidiary: 'Chưa chọn công ty con.',
		empty: 'Không có số liệu trong kỳ này.',
		suggested: 'Kỳ gợi ý',
		noBatch: 'Chưa có bảng lương đã tính',
		batchInfo: (n, pending) => `${n} bảng lương${pending > 0 ? `, ${pending} chưa ghi sổ` : ', đã ghi sổ hết'}`,
		quarterOf: (q, y) => `Quý ${q}/${y}`,
		yearOf: (y) => `Năm ${y}`,
		cadence: {monthly: 'Hằng tháng', quarterly: 'Hằng quý', yearly: 'Hằng năm', print: 'Bản in bảng lương'},
		cadenceNote: {
			monthly: 'Đóng bảo hiểm và đối chiếu chi phí lương của tháng',
			quarterly: 'Tờ khai khấu trừ thuế TNCN của quý',
			yearly: 'Quyết toán thuế TNCN và theo dõi thuế cả năm',
			print: 'Chứng từ in từ một bảng lương',
		},
		reports: {
			insurance: {title: 'Bảo hiểm phải nộp và D02-LT', desc: 'BHXH, BHYT, BHTN theo từng người; danh sách biến động D02-LT; đối chiếu thông báo C12-TS.'},
			cost: {title: 'Chi phí lương theo tài khoản', desc: 'Chi phí theo tài khoản và phòng ban, so với bút toán ghi sổ của bảng lương.'},
			fund: {title: 'Quỹ lương theo phòng ban', desc: 'Số người, thu nhập, thực lĩnh và tổng quỹ lương theo phòng ban, loại lao động.'},
			pitq: {title: 'Tờ khai 05/KK-TNCN', desc: 'Chỉ tiêu [16] - [32], danh sách cá nhân và phiếu số liệu để nhập HTKK.'},
			pitLedger: {title: 'Sổ theo dõi thuế TNCN đã khấu trừ', desc: 'Thuế đã khấu trừ của từng người theo 12 tháng trong năm.'},
			pita: {title: 'Quyết toán thuế TNCN năm', desc: 'Bảng kê 05-1/BK, 05-2/BK và bảng dữ liệu để nhập HTKK.'},
			print: {title: 'Phiếu lương, bảng thanh toán, quyết toán CTV', desc: 'Chọn bảng lương rồi in phiếu lương, bảng thanh toán tiền lương hoặc quyết toán cộng tác viên.'},
		},
		filter: {
			month: 'Tháng tính thuế', year: 'Năm', quarter: 'Quý', scope: 'Phạm vi', schedule: 'Bảng kê', released: 'Nguồn số liệu',
			scopes: {month: 'Theo tháng', quarter: 'Theo quý', year: 'Cả năm'},
			allSchedules: '05-1/BK và 05-2/BK',
			rel: {F: 'Mọi bảng đã tính', T: 'Chỉ bảng đã ghi sổ'},
			c12: 'Số trên thông báo C12-TS',
			c12Apply: 'Đối chiếu',
			c12Clear: 'Bỏ đối chiếu',
		},
		grid: {
			search: 'Tìm mã, họ tên, số tiền',
			matches: (n) => `${n} dòng khớp`,
			rows: (from, to, n) => `Dòng ${from} - ${to} / ${n}`,
			prev: 'Trang trước',
			next: 'Trang sau',
			csv: 'Xuất CSV',
			csvAll: (n) => `Xuất toàn bộ ${n} dòng ra file CSV (mở được bằng Excel)`,
			total: 'Tổng cộng',
			count: (n) => `${n} dòng`,
		},
		etype: {E: 'Nhân viên', C: 'Cộng tác viên'},
		status: {H: 'Tạm giữ', B: 'Chờ tính', C: 'Đã tính', P: 'Chờ duyệt', A: 'Đã duyệt', J: 'Từ chối', R: 'Đã ghi sổ', V: 'Đã đảo'},
		note: {
			pendingIncluded: (n) => `Số liệu gồm ${n} bảng lương chưa ghi sổ - có thể còn thay đổi trước khi nộp.`,
			pendingExcluded: (n) => `Còn ${n} bảng lương của kỳ chưa ghi sổ nên chưa có trong số liệu.`,
			c12Diff: (diff, c12) => `Lệch ${diff} so với thông báo C12-TS (${c12}). Kiểm tra người tăng, giảm và mức đóng trước khi nộp.`,
			c12Ok: (c12) => `Khớp với thông báo C12-TS (${c12}).`,
			noPrev: 'Tháng trước chưa có bảng lương: D02-LT chỉ báo tăng những người vào làm trong tháng.',
			noSiNumber: (n) => `${n} người chưa có số sổ BHXH trên hồ sơ lương.`,
			glDiff: (n, diff) => `${n} tài khoản lệch giữa bảng lương và bút toán, tổng lệch ${diff}.`,
			glNone: 'Không đọc được bút toán nên chưa so sánh được với sổ cái.',
			glOk: 'Chi phí trên bảng lương khớp với bút toán ghi sổ.',
			noTaxCode: (n) => `${n} cá nhân chưa có mã số thuế trên hồ sơ lương.`,
			noTaxCodeWithheld: (n) => `${n} người đã bị khấu trừ thuế nhưng chưa có mã số thuế trên hồ sơ lương.`,
			negativePit: (n) => `${n} người có tháng thuế khấu trừ âm.`,
			noDepartment: (n) => `${n} người chưa có phòng ban trên hồ sơ lương hoặc hồ sơ nhân viên.`,
			deptNow: 'Phòng ban lấy theo hồ sơ hiện tại, không phải tại thời điểm tính lương.',
		},
		ins: {
			tabMain: 'Bảo hiểm phải nộp', tabD02: 'Biến động D02-LT',
			people: 'Số người đóng', wage: 'Tổng lương đóng BH', ee: 'Người lao động đóng', er: 'Doanh nghiệp đóng', total: 'Phải nộp (BHXH, BHYT, BHTN)',
			union: (fund, fee) => `KPCĐ ${fund} - đoàn phí ${fee}`,
			c12: 'Chênh lệch với C12-TS', c12None: 'Chưa nhập số C12-TS', c12Of: (v) => `C12-TS: ${v}`,
			d02Empty: 'Không có biến động trong tháng.',
			changes: (n) => `${n} biến động`,
		},
		cost: {total: 'Tổng chi phí lương', wages: 'Lương', er: 'BH doanh nghiệp đóng', other: 'Trích tháng 13 và phí CTV', gl: 'Trên bút toán (Nợ - Có)', diff: 'Chênh lệch', notCompared: 'Chưa so sánh'},
		pit: {
			tabInd: 'Chỉ tiêu tờ khai', tabPeople: 'Danh sách cá nhân', tabHtkk: 'Phiếu nhập HTKK', tabSchedules: 'Bảng kê quyết toán', tabData: 'Dữ liệu nhập HTKK',
			code: 'Mã', item: 'Chỉ tiêu', value: 'Số liệu', remark: 'Ghi chú',
			people: 'Số cá nhân', bySchedule: (a, b) => `05-1/BK: ${a} - 05-2/BK: ${b}`,
			taxable: 'Thu nhập chịu thuế', family: 'Giảm trừ gia cảnh', assessable: 'Thu nhập tính thuế', withheld: 'Thuế TNCN đã khấu trừ', withheldPeople: 'Số người đã khấu trừ',
			viewPit: 'Thuế đã khấu trừ', viewTaxable: 'Thu nhập chịu thuế',
		},
		htkk: {
			title: 'Phiếu số liệu nhập HTKK',
			taxpayer: 'Người nộp thuế', taxId: 'Mã số thuế', period: 'Kỳ tính thuế', form: 'Mẫu',
			noTaxId: '(chưa có - khai mã số thuế trên hồ sơ công ty con của NetSuite)',
			noName: '(chưa có tên pháp lý)',
			notComputed: 'Gói chưa tính - tự nhập nếu có phát sinh',
			unreleased: 'Số liệu gồm bảng lương chưa ghi sổ.',
			basis: 'Thứ tự cột theo gói Acumatica (màn VP404000), chưa đối chiếu với phụ lục của mẫu pháp lý; cột không mang mã chỉ tiêu. Kiểm tra lại trước khi nhập HTKK.',
			basisQuarter: 'Mã và tên chỉ tiêu theo tờ khai của gói; phiếu để nhập lại vào HTKK, không thay tờ khai XML. Kiểm tra số trước khi nộp.',
			print: 'In phiếu',
			printedAt: (d) => `In ngày ${d}. Số liệu để nhập lại vào HTKK; kiểm tra trước khi nộp tờ khai.`,
			scheduleTitle: (s, n) => `Bảng kê ${s} - ${n} cá nhân`,
			scheduleInfo: (withheld, noCode) => `${withheld} người đã khấu trừ thuế${noCode > 0 ? `, ${noCode} người chưa có mã số thuế` : ''}`,
		},
		fund: {people: 'Số người', byType: (e, c) => `Nhân viên ${e} - cộng tác viên ${c}`, gross: 'Tổng thu nhập', net: 'Thực lĩnh', er: 'Doanh nghiệp đóng và trích tháng 13', cost: 'Tổng quỹ lương', costNote: 'Thu nhập + phần doanh nghiệp đóng + trích tháng 13'},
		print: {
			sub: 'Bảng lương đã tính của công ty con đang chọn.',
			payslip: 'Phiếu lương', payment: 'Bảng thanh toán', contractor: 'Quyết toán CTV',
			number: 'Số', period: 'Kỳ', status: 'Trạng thái', count: 'Số người', net: 'Thực lĩnh', docs: 'Bản in', openRun: 'Mở bảng lương',
			empty: 'Chưa có bảng lương đã tính để in.',
			search: 'Tìm số, kỳ, trạng thái',
		},
	},
	en: {
		title: 'Reports - declarations',
		sub: 'Pick a filing by its deadline. Each item opens on the latest period that has data.',
		latest: (calc, rel) => `Latest calculated period: ${calc || 'none'} - released: ${rel || 'none'}`,
		legacy: 'Previous screen',
		back: 'Reports - declarations',
		reload: 'Refresh',
		open: 'Open',
		loading: 'Loading...',
		waiting: 'Loading figures...',
		noSubsidiary: 'No subsidiary selected.',
		empty: 'No figures in this period.',
		suggested: 'Suggested period',
		noBatch: 'No calculated payroll yet',
		batchInfo: (n, pending) => `${n} batch${n === 1 ? '' : 'es'}${pending > 0 ? `, ${pending} not released` : ', all released'}`,
		quarterOf: (q, y) => `Q${q} ${y}`,
		yearOf: (y) => `Year ${y}`,
		cadence: {monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', print: 'Payroll printouts'},
		cadenceNote: {
			monthly: 'Insurance contributions and payroll cost check for the month',
			quarterly: 'PIT withholding declaration for the quarter',
			yearly: 'PIT finalization and year-round PIT tracking',
			print: 'Documents printed from one payroll batch',
		},
		reports: {
			insurance: {title: 'Insurance payable and D02-LT', desc: 'Social, health and unemployment insurance per employee; D02-LT change list; check against the C12-TS notice.'},
			cost: {title: 'Payroll cost by account', desc: 'Cost by account and department, compared with the journal entries of the payroll batches.'},
			fund: {title: 'Payroll fund by department', desc: 'Headcount, gross, net and total payroll cost by department and employment type.'},
			pitq: {title: 'Form 05/KK-TNCN', desc: 'Indicators [16] - [32], the list of individuals and the data sheet for HTKK entry.'},
			pitLedger: {title: 'PIT withholding ledger', desc: 'PIT withheld per employee across the 12 months of the year.'},
			pita: {title: 'Annual PIT finalization', desc: 'Schedules 05-1/BK, 05-2/BK and the data tables for HTKK entry.'},
			print: {title: 'Payslips, payment sheet, contractor settlement', desc: 'Pick a payroll batch, then print payslips, the payroll payment sheet or the contractor settlement.'},
		},
		filter: {
			month: 'Tax month', year: 'Year', quarter: 'Quarter', scope: 'Range', schedule: 'Schedule', released: 'Data source',
			scopes: {month: 'By month', quarter: 'By quarter', year: 'Full year'},
			allSchedules: '05-1/BK and 05-2/BK',
			rel: {F: 'All calculated batches', T: 'Released batches only'},
			c12: 'Amount on the C12-TS notice',
			c12Apply: 'Compare',
			c12Clear: 'Clear comparison',
		},
		grid: {
			search: 'Search ID, name, amount',
			matches: (n) => `${n} matching rows`,
			rows: (from, to, n) => `Rows ${from} - ${to} of ${n}`,
			prev: 'Previous page',
			next: 'Next page',
			csv: 'Export CSV',
			csvAll: (n) => `Export all ${n} rows to a CSV file (opens in Excel)`,
			total: 'Total',
			count: (n) => `${n} rows`,
		},
		etype: {E: 'Employee', C: 'Contractor'},
		status: {H: 'On hold', B: 'Pending calculation', C: 'Calculated', P: 'Pending approval', A: 'Approved', J: 'Rejected', R: 'Released', V: 'Reversed'},
		note: {
			pendingIncluded: (n) => `The figures include ${n} unreleased payroll batch${n === 1 ? '' : 'es'} - they may still change before filing.`,
			pendingExcluded: (n) => `${n} payroll batch${n === 1 ? '' : 'es'} of this period ${n === 1 ? 'is' : 'are'} not released yet and ${n === 1 ? 'is' : 'are'} not in the figures.`,
			c12Diff: (diff, c12) => `Off by ${diff} against the C12-TS notice (${c12}). Check joiners, leavers and contribution wages before paying.`,
			c12Ok: (c12) => `Matches the C12-TS notice (${c12}).`,
			noPrev: 'No payroll in the previous month: D02-LT only reports new hires of this month as increases.',
			noSiNumber: (n) => `${n} employee(s) have no social insurance book number on the payroll profile.`,
			glDiff: (n, diff) => `${n} account(s) differ between payroll and journal entries, total difference ${diff}.`,
			glNone: 'Journal entries could not be read, so there is no comparison with the ledger yet.',
			glOk: 'Payroll cost matches the posted journal entries.',
			noTaxCode: (n) => `${n} individual(s) have no tax code on the payroll profile.`,
			noTaxCodeWithheld: (n) => `${n} employee(s) with PIT withheld have no tax code on the payroll profile.`,
			negativePit: (n) => `${n} employee(s) have a month with negative PIT withheld.`,
			noDepartment: (n) => `${n} employee(s) have no department on the payroll profile or the employee record.`,
			deptNow: 'Departments come from the current profile, not from the time payroll was calculated.',
		},
		ins: {
			tabMain: 'Insurance payable', tabD02: 'D02-LT changes',
			people: 'Contributors', wage: 'Total insurance wage', ee: 'Employee share', er: 'Employer share', total: 'Payable (social, health, unemployment)',
			union: (fund, fee) => `Trade union fund ${fund} - union fee ${fee}`,
			c12: 'Difference against C12-TS', c12None: 'C12-TS amount not entered', c12Of: (v) => `C12-TS: ${v}`,
			d02Empty: 'No changes in this month.',
			changes: (n) => `${n} change${n === 1 ? '' : 's'}`,
		},
		cost: {total: 'Total payroll cost', wages: 'Wages', er: 'Employer contributions', other: '13th-month accrual and contractor fees', gl: 'On journal entries (Dr - Cr)', diff: 'Difference', notCompared: 'Not compared'},
		pit: {
			tabInd: 'Declaration indicators', tabPeople: 'Individuals', tabHtkk: 'HTKK data sheet', tabSchedules: 'Finalization schedules', tabData: 'HTKK data tables',
			code: 'Code', item: 'Indicator', value: 'Figure', remark: 'Remark',
			people: 'Individuals', bySchedule: (a, b) => `05-1/BK: ${a} - 05-2/BK: ${b}`,
			taxable: 'Taxable income', family: 'Family deductions', assessable: 'Assessable income', withheld: 'PIT withheld', withheldPeople: 'Individuals with PIT withheld',
			viewPit: 'PIT withheld', viewTaxable: 'Taxable income',
		},
		htkk: {
			title: 'HTKK data sheet',
			taxpayer: 'Taxpayer', taxId: 'Tax ID', period: 'Tax period', form: 'Form',
			noTaxId: '(missing - enter the tax ID on the NetSuite subsidiary record)',
			noName: '(legal name missing)',
			notComputed: 'Not calculated by the package - enter manually if applicable',
			unreleased: 'The figures include payroll batches that have not been released.',
			basis: 'Column order follows the Acumatica package (form VP404000) and has not been checked against the statutory appendix; columns carry no indicator codes. Review before entering into HTKK.',
			basisQuarter: 'Indicator codes and names follow the declaration in the package; the sheet is for re-entry into HTKK and does not replace the XML declaration. Check the figures before filing.',
			print: 'Print sheet',
			printedAt: (d) => `Printed on ${d}. The figures are for re-entry into HTKK; check them before submitting the declaration.`,
			scheduleTitle: (s, n) => `Schedule ${s} - ${n} individual${n === 1 ? '' : 's'}`,
			scheduleInfo: (withheld, noCode) => `${withheld} with PIT withheld${noCode > 0 ? `, ${noCode} without a tax code` : ''}`,
		},
		fund: {people: 'Headcount', byType: (e, c) => `Employees ${e} - contractors ${c}`, gross: 'Gross pay', net: 'Net pay', er: 'Employer contributions and 13th-month accrual', cost: 'Total payroll cost', costNote: 'Gross + employer contributions + 13th-month accrual'},
		print: {
			sub: 'Calculated payroll batches of the selected subsidiary.',
			payslip: 'Payslips', payment: 'Payment sheet', contractor: 'Contractor settlement',
			number: 'Number', period: 'Period', status: 'Status', count: 'Employees', net: 'Net pay', docs: 'Printouts', openRun: 'Open payroll batch',
			empty: 'No calculated payroll batch to print yet.',
			search: 'Search number, period, status',
		},
	},
};

const REPORTS = ['insurance', 'cost', 'fund', 'pitq', 'pitLedger', 'pita', 'print'];
const CADENCES = ['monthly', 'quarterly', 'yearly', 'print'];
const CADENCE_OF = {insurance: 'monthly', cost: 'monthly', fund: 'monthly', pitq: 'quarterly', pitLedger: 'yearly', pita: 'yearly', print: 'print'};
const STATUS_TONE = {H: 'muted', B: 'info', C: 'warn', P: 'warn', A: 'ok', J: 'error', R: 'ok', V: 'muted'};
const PAGE_SIZE = 200;
// Chiều cao khung bảng: phần còn lại của màn hình dưới tiêu đề, thẻ số, tab và thanh công cụ (không thấp hơn 240 px)
const GRID_HEIGHT = 'max(200px, calc(100vh - 464px))';

const blank = (v) => v === null || v === undefined || v === '';
const monthLabel = (m) => (/^\d{6}$/.test(String(m || '')) ? `${String(m).slice(4, 6)}/${String(m).slice(0, 4)}` : '');
const quarterOfMonth = (m) => Math.floor((Number(String(m).slice(4, 6)) - 1) / 3) + 1;
const sumBy = (rows, key) => (rows || []).reduce((s, r) => s + (Number(r[key]) || 0), 0);

const formatCell = (col, v) => (col.type === 'money' ? money(v) : col.type === 'number' ? num(v) : col.type === 'pct' ? pct(v) : blank(v) ? '' : String(v));
const isRight = (col) => col.align === 'right' || (!col.align && (col.type === 'money' || col.type === 'number' || col.type === 'pct'));

// CSV cho Excel: UTF-8 có BOM, mọi ô trong ngoặc kép, số để nguyên (không chèn dấu phân cách hàng nghìn)
function toCsv(columns, rows) {
	const esc = (v) => `"${String(blank(v) ? '' : v).replace(/"/g, '""')}"`;
	const cols = columns.filter((c) => c.csv !== false);
	const head = cols.map((c) => esc(c.label)).join(',');
	const body = rows.map((r) => cols.map((c) => esc(r[c.key])).join(','));
	return '﻿' + [head].concat(body).join('\r\n');
}

// Cột do máy chủ trả ({key, vi, en, type}) -> cột của lưới; over: ghi đè theo khóa (đổi khóa, thêm render)
const gridColumns = (columns, over) => (columns || []).map((c) => Object.assign({key: c.key, label: localized(c), type: c.type, nowrap: true}, (over || {})[c.key] || {}));

// ------------------------------------------------------------------ lưới có ô tìm, phân trang, dòng tổng, xuất CSV

function GridImpl({columns, rows, total, empty, placeholder, toolbar, label, exportName, pin, height, plain}) {
	const t = pick(TEXT).grid;
	const [query, setQuery] = useState('');
	const [page, setPage] = useState(0);
	const cols = (columns || []).filter(Boolean);
	const all = Array.isArray(rows) ? rows : [];
	let shown = {rows: all, count: null};
	try {
		shown = quickFilter(all, query);
	} catch (e) {
		shown = {rows: all, count: null};
	}
	const pages = Math.max(1, Math.ceil(shown.rows.length / PAGE_SIZE));
	const at = Math.min(page, pages - 1);
	const slice = shown.rows.length > PAGE_SIZE ? shown.rows.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE) : shown.rows;
	const cls = (c) => `${isRight(c) ? 's4vp-r' : ''}${c.nowrap ? ' s4vp-nw' : ''}`.trim();
	const attrsOf = (c) => {
		const a = {};
		const k = cls(c);
		if (k) a.class = k;
		return a;
	};
	const cell = (c, row) => {
		try {
			if (c.render) {
				const v = c.render(row);
				return blank(v) || v === false ? '' : v;
			}
			return formatCell(c, row[c.key]);
		} catch (e) {
			return '';
		}
	};
	const wrap = {class: `s4vp-tbl-wrap${pin ? ' s4vp-rp-pin' : ''}`};
	if (!plain) wrap.style = {maxHeight: height || GRID_HEIGHT, overflowY: 'auto'};
	const table = {class: `s4vp-tbl${plain ? '' : ' s4vp-tbl-sticky'}`};
	if (label) table['aria-label'] = label;
	const exportAll = () => download(exportName, toCsv(cols, all));
	const prevAttrs = {type: 'button', class: 's4vp-btn s4vp-btn-sm', 'aria-label': t.prev, title: t.prev};
	const nextAttrs = {type: 'button', class: 's4vp-btn s4vp-btn-sm', 'aria-label': t.next, title: t.next};
	if (at <= 0) prevAttrs.disabled = 'disabled';
	else prevAttrs.onClick = () => setPage(at - 1);
	if (at >= pages - 1) nextAttrs.disabled = 'disabled';
	else nextAttrs.onClick = () => setPage(at + 1);
	return (
		<div class="s4vp-rp-grid">
			<div class="s4vp-tbl-bar">
				<div class="s4vp-tbl-bar-l">{toolbar || null}</div>
				<div class="s4vp-tbl-bar-r">
					{shown.rows.length > PAGE_SIZE ? (
						<span class="s4vp-rp-pager">
							<span class="s4vp-tbl-count">{t.rows(num(at * PAGE_SIZE + 1), num(Math.min((at + 1) * PAGE_SIZE, shown.rows.length)), num(shown.rows.length))}</span>
							<button {...prevAttrs}>{'‹'}</button>
							<button {...nextAttrs}>{'›'}</button>
						</span>
					) : (
						<span class="s4vp-tbl-count">{shown.count === null ? t.count(num(all.length)) : t.matches(num(shown.count))}</span>
					)}
					<SearchBox
						value={query}
						onInput={(v) => {
							setQuery(v);
							setPage(0);
						}}
						placeholder={placeholder || t.search}
						width={240}
					/>
					{exportName ? <Button label={t.csv} small={true} disabled={!all.length} title={t.csvAll(num(all.length))} onClick={exportAll} /> : null}
				</div>
			</div>
			<div {...wrap}>
				<table {...table}>
					<thead>
						<tr>
							{cols.map((c, i) => (
								<th key={`h${c.key || i}`} {...attrsOf(c)}>
									{blank(c.label) ? '' : String(c.label)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{slice.map((row, i) => (
							<tr key={`r${at}-${i}`} class="s4vp-row">
								{cols.map((c, j) => (
									<td key={`c${c.key || j}`} {...attrsOf(c)}>
										{cell(c, row)}
									</td>
								))}
							</tr>
						))}
						{slice.length ? null : (
							<tr key="rp-empty">
								<td colSpan={String(cols.length || 1)}>
									<div class="s4vp-empty">{empty || pick(TEXT).empty}</div>
								</td>
							</tr>
						)}
						{total && all.length ? (
							<tr key="rp-total" class="s4vp-total">
								{cols.map((c, j) => (
									<td key={`t${c.key || j}`} {...attrsOf(c)}>
										{j === 0 && blank(total[c.key]) ? t.total : c.noTotal ? '' : formatCell(c, total[c.key])}
									</td>
								))}
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function Grid(props) {
	return <GridImpl {...props} />;
}

// ------------------------------------------------------------------ điểm bất thường

// notes: [{tone: 'error' | 'warn' | 'ok' | 'info', text}]
function Notes({notes}) {
	const list = (notes || []).filter((n) => n && n.text);
	if (!list.length) return null;
	return (
		<div class="s4vp-rp-notes">
			{list.map((n, i) => (
				<div key={`n${i}`} class={`s4vp-rp-note s4vp-rp-note-${n.tone || 'info'}`} role={n.tone === 'error' ? 'alert' : 'status'}>
					{n.text}
				</div>
			))}
		</div>
	);
}

// ------------------------------------------------------------------ phiếu in (trang HTML rời mở ở tab mới)

const escapeHtml = (s) => String(blank(s) ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sheetHtml({title, heading, lines, columns, rows, notes, foot, printLabel}) {
	const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
	const body = rows.map((r) => `<tr>${columns.map((c) => `<td class="${isRight(c) ? 'n' : c.center ? 'c' : ''}">${escapeHtml(c.print ? c.print(r) : formatCell(c, r[c.key]))}</td>`).join('')}</tr>`).join('');
	const css = 'body{font-family:"Times New Roman",serif;font-size:13pt;margin:24px;color:#000;background:#fff}h1{font-size:15pt;text-align:center;margin:0 0 4px}h2{font-size:13pt;text-align:center;font-weight:normal;margin:0 0 16px}'
		+ 'table.h td{padding:2px 8px 2px 0}table.d{border-collapse:collapse;width:100%;margin-top:12px}table.d th,table.d td{border:1px solid #000;padding:4px 6px;vertical-align:top}table.d th{background:#eee}'
		+ 'td.c{text-align:center;white-space:nowrap}td.n{text-align:right;white-space:nowrap}.note{margin-top:10px;font-style:italic}.foot{margin-top:16px;font-size:10pt;color:#444}button{margin-bottom:12px}@media print{button{display:none}body{margin:0}}';
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><button onclick="window.print()">${escapeHtml(printLabel)}</button>`
		+ `<h1>${escapeHtml(title)}</h1><h2>${escapeHtml(heading)}</h2><table class="h">${lines.map((l) => `<tr><td>${escapeHtml(l.label)}:</td><td><b>${escapeHtml(l.value)}</b></td></tr>`).join('')}</table>`
		+ `<table class="d"><tr>${head}</tr>${body}</table>${(notes || []).map((n) => `<div class="note">${escapeHtml(n)}</div>`).join('')}<div class="foot">${escapeHtml(foot)}</div></body></html>`;
}

function openSheet(html) {
	try {
		const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
		const href = URL.createObjectURL(blob);
		window.open(href, '_blank');
		setTimeout(() => URL.revokeObjectURL(href), 60000);
	} catch (e) {
		// Trình duyệt chặn cửa sổ mới: người dùng vẫn xuất được CSV
	}
}

// ------------------------------------------------------------------ màn hình

export default function ReportsHubView({app}) {
	const t = pick(TEXT);
	const params = (app.route && app.route.params) || {};
	const boot = app.boot || {};
	const subsidiary = app.subsidiary || '';
	const report = REPORTS.indexOf(params.report) >= 0 ? params.report : '';
	const [catalog, setCatalog] = useState(null);
	const [result, setResult] = useState(null);
	const [extra, setExtra] = useState(null);
	// Số C12-TS đang gõ (chỉ áp dụng khi bấm Đối chiếu hoặc Enter)
	const c12Ref = useRef(null);
	const [, setC12Draft] = useState('');
	const alive = useRef(true);
	const seq = useRef(0);
	const extraSeq = useRef(0);

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	// Danh mục và kỳ gợi ý của công ty con
	useEffect(() => {
		if (!subsidiary) return undefined;
		let on = true;
		app.run(t.loading, call({action: 'reportsCatalog', subsidiary})).then((r) => {
			if (on && alive.current) setCatalog({sub: subsidiary, data: r || {}});
		});
		return () => {
			on = false;
		};
	}, [subsidiary]);

	const cat = catalog && catalog.sub === subsidiary ? catalog.data : null;
	const items = (cat && Array.isArray(cat.items) ? cat.items : []).filter(Boolean);
	const itemOf = (key) => items.find((i) => i.key === key) || {key, period: {}};
	const catMonths = (cat && Array.isArray(cat.months) ? cat.months : []).filter(Boolean);
	const today = localToday();
	const thisMonth = today.slice(0, 4) + today.slice(5, 7);

	// Tham số đang dùng: hash -> kỳ gợi ý của danh mục -> hôm nay
	const suggested = itemOf(report).period || {};
	const baseMonth = suggested.taxMonth || (cat && cat.latest && cat.latest.calculated) || thisMonth;
	const month = /^\d{6}$/.test(params.month || '') ? params.month : baseMonth;
	const year = /^\d{4}$/.test(params.year || '') ? params.year : String(suggested.year || baseMonth.slice(0, 4));
	const quarter = /^[1-4]$/.test(params.quarter || '') ? params.quarter : String(suggested.quarter || quarterOfMonth(baseMonth));
	const rel = params.rel === 'T' || params.rel === 'F' ? params.rel : report === 'cost' ? 'T' : 'F';
	const schedule = params.schedule === '05-1' || params.schedule === '05-2' ? params.schedule : '';
	const scope = params.scope === 'quarter' || params.scope === 'year' ? params.scope : 'month';
	const c12 = toNumber(params.c12) === null ? '' : String(toNumber(params.c12));
	const tab = params.tab || '';

	const go = (patch) =>
		app.go('reportsHub', Object.assign({report, month: params.month, year: params.year, quarter: params.quarter, rel: params.rel, schedule: params.schedule, scope: params.scope, c12: params.c12, tab: params.tab}, patch));

	// Lượt gọi của báo cáo đang mở
	let request = null;
	if (subsidiary && report === 'insurance') {
		request = {action: 'report', type: 'insurance', subsidiary, taxMonth: month, releasedOnly: rel};
		if (c12 !== '') request.c12 = c12;
	} else if (subsidiary && report === 'cost') request = {action: 'report', type: 'cost', subsidiary, taxMonth: month, releasedOnly: rel};
	else if (subsidiary && report === 'pitq') request = {action: 'report', type: 'pitq', subsidiary, year, quarter, releasedOnly: rel};
	else if (subsidiary && report === 'pita') request = {action: 'report', type: 'pita', subsidiary, year, schedule, releasedOnly: rel};
	else if (subsidiary && report === 'fund') {
		request = {action: 'reportsFund', subsidiary, releasedOnly: rel};
		if (scope === 'month') request.taxMonth = month;
		else {
			request.year = year;
			if (scope === 'quarter') request.quarter = quarter;
		}
	} else if (subsidiary && report === 'pitLedger') request = {action: 'reportsPitLedger', subsidiary, year, releasedOnly: rel};
	else if (subsidiary && report === 'print') request = {action: 'batches', subsidiary};
	// Chưa có danh mục và hash không nêu kỳ: chờ kỳ gợi ý rồi mới tải (tránh tải hai lần)
	const ready = cat !== null || !!(params.month || params.year) || report === 'print';
	const requestKey = request && ready ? JSON.stringify(request) : '';

	const load = () => {
		if (!requestKey) return;
		seq.current += 1;
		const mine = seq.current;
		app.run(t.loading, call(request)).then((r) => {
			if (!alive.current || mine !== seq.current) return;
			setResult({key: requestKey, data: r || null});
		});
	};
	useEffect(() => {
		load();
	}, [requestKey]);

	// Phiếu số liệu nhập HTKK: chỉ tải khi mở tab
	const htkkForm = report === 'pitq' && tab === 'htkk' ? '05kk' : report === 'pita' && tab === 'htkk' ? '05qtt' : '';
	let extraRequest = null;
	if (subsidiary && htkkForm) {
		extraRequest = {action: 'reportsHtkk', form: htkkForm, subsidiary, year, releasedOnly: rel};
		if (htkkForm === '05kk') extraRequest.quarter = quarter;
	}
	const extraKey = extraRequest && ready ? JSON.stringify(extraRequest) : '';
	useEffect(() => {
		if (!extraKey) return;
		extraSeq.current += 1;
		const mine = extraSeq.current;
		app.run(t.loading, call(extraRequest)).then((r) => {
			if (!alive.current || mine !== extraSeq.current) return;
			setExtra({key: extraKey, data: r || null});
		});
	}, [extraKey]);

	const data = result && result.key === requestKey ? result.data : null;
	const pending = !!requestKey && !(result && result.key === requestKey);
	const sheet = extra && extra.key === extraKey ? extra.data : null;

	// ---------------------------------------------------------------- danh mục

	const periodText = (item) => {
		const p = item.period || {};
		if (item.cadence === 'quarterly') return p.year ? t.quarterOf(p.quarter, p.year) : '';
		if (item.cadence === 'yearly') return p.year ? t.yearOf(p.year) : '';
		return monthLabel(p.taxMonth);
	};
	const openItem = (item) => {
		const p = item.period || {};
		if (item.cadence === 'monthly') app.go('reportsHub', {report: item.key, month: p.taxMonth});
		else if (item.cadence === 'quarterly') app.go('reportsHub', {report: item.key, year: p.year, quarter: p.quarter});
		else if (item.cadence === 'yearly') app.go('reportsHub', {report: item.key, year: p.year});
		else app.go('reportsHub', {report: item.key});
	};

	if (!report) {
		const list = items.length ? items : REPORTS.map((key) => ({key, cadence: CADENCE_OF[key], period: {}, hasData: false, batches: 0, pending: 0}));
		const latest = (cat && cat.latest) || {};
		return (
			<Page>
				<PageHeader
					title={t.title}
					sub={!subsidiary ? t.noSubsidiary : cat ? `${t.sub} ${t.latest(monthLabel(latest.calculated), monthLabel(latest.released))}` : t.sub}
					actions={[<Button label={t.legacy} kind="ghost" onClick={() => app.go('reports')} />]}
				/>
				<div class="s4vp-rp-hub">
					{CADENCES.map((cadence) => (
						<section key={cadence} class="s4vp-rp-group" aria-label={t.cadence[cadence]}>
							<div class="s4vp-rp-group-h">
								<h2>{t.cadence[cadence]}</h2>
								<div class="s4vp-small">{t.cadenceNote[cadence]}</div>
							</div>
							{list
								.filter((i) => (i.cadence || CADENCE_OF[i.key]) === cadence && t.reports[i.key])
								.map((item) => {
									const printBatch = item.key === 'print' && cat && cat.printBatch ? cat.printBatch : null;
									const period = printBatch ? `${printBatch.name} - ${monthLabel(printBatch.taxMonth)}` : periodText(item);
									return (
										<div key={item.key} class="s4vp-rp-item">
											<div class="s4vp-rp-item-t">{t.reports[item.key].title}</div>
											<div class="s4vp-rp-item-d">{t.reports[item.key].desc}</div>
											<div class="s4vp-rp-item-f">
												<div class="s4vp-rp-item-p">
													{item.hasData ? (
														<span>
															<span class="s4vp-rp-item-k">{`${t.suggested}: `}</span>
															<b>{period}</b>
															<span class="s4vp-small">{` - ${t.batchInfo(item.batches, item.pending)}`}</span>
														</span>
													) : (
														<span class="s4vp-small">{cat ? t.noBatch : ''}</span>
													)}
												</div>
												<Button label={t.open} small={true} disabled={!subsidiary} ariaLabel={`${t.open} ${t.reports[item.key].title}`} onClick={() => openItem(item)} />
											</div>
										</div>
									);
								})}
						</section>
					))}
				</div>
			</Page>
		);
	}

	// ---------------------------------------------------------------- bộ lọc trên hàng tiêu đề

	const monthValues = {};
	catMonths.forEach((m) => (monthValues[m.taxMonth] = true));
	(Array.isArray(boot.periods) ? boot.periods : []).forEach((p) => p && /^\d{6}$/.test(p.taxMonth || '') && (monthValues[p.taxMonth] = true));
	monthValues[month] = true;
	const monthOptions = Object.keys(monthValues).sort().reverse().map((m) => ({value: m, label: monthLabel(m)}));
	const yearValues = {};
	Object.keys(monthValues).forEach((m) => (yearValues[m.slice(0, 4)] = true));
	yearValues[year] = true;
	yearValues[today.slice(0, 4)] = true;
	const yearOptions = Object.keys(yearValues).sort().reverse().map((y) => ({value: y, label: y}));
	const quarterOptions = ['1', '2', '3', '4'].map((q) => ({value: q, label: t.quarterOf(q, year)}));
	const monthSelect = <AutoSelect value={month} onInput={(v) => v && go({month: v})} options={monthOptions} ariaLabel={t.filter.month} title={t.filter.month} width={118} />;
	const yearSelect = <Select value={year} onInput={(v) => v && go({year: v})} options={yearOptions} ariaLabel={t.filter.year} title={t.filter.year} width={92} />;
	const quarterSelect = <Select value={quarter} onInput={(v) => v && go({quarter: v, year})} options={quarterOptions} ariaLabel={t.filter.quarter} title={t.filter.quarter} width={128} />;
	const relSelect = <Select value={rel} onInput={(v) => v && go({rel: v})} options={[{value: 'F', label: t.filter.rel.F}, {value: 'T', label: t.filter.rel.T}]} ariaLabel={t.filter.released} title={t.filter.released} width={190} />;
	const controls = [];
	if (report === 'insurance' || report === 'cost') controls.push(monthSelect);
	if (report === 'fund') {
		controls.push(<Select value={scope} onInput={(v) => v && go({scope: v === 'month' ? '' : v, year, quarter})} options={['month', 'quarter', 'year'].map((s) => ({value: s, label: t.filter.scopes[s]}))} ariaLabel={t.filter.scope} title={t.filter.scope} width={128} />);
		if (scope === 'month') controls.push(monthSelect);
		else controls.push(yearSelect);
		if (scope === 'quarter') controls.push(quarterSelect);
	}
	if (report === 'pitq') controls.push(yearSelect, quarterSelect);
	if (report === 'pita' || report === 'pitLedger') controls.push(yearSelect);
	if (report === 'pita') {
		controls.push(<Select value={schedule} onInput={(v) => go({schedule: v})} options={[{value: '05-1', label: '05-1/BK'}, {value: '05-2', label: '05-2/BK'}]} placeholder={t.filter.allSchedules} ariaLabel={t.filter.schedule} title={t.filter.schedule} width={178} />);
	}
	if (report !== 'print') controls.push(relSelect);
	controls.push(<Button label={t.reload} disabled={!!app.busy || !requestKey} onClick={load} />);

	// Số bảng lương chưa ghi sổ trong phạm vi kỳ của báo cáo đang mở (theo danh mục)
	const inRange = (m) => {
		if (report === 'insurance' || report === 'cost' || (report === 'fund' && scope === 'month')) return m === month;
		if (report === 'pitq' || (report === 'fund' && scope === 'quarter')) return m.slice(0, 4) === year && String(quarterOfMonth(m)) === quarter;
		return m.slice(0, 4) === year;
	};
	const pendingBatches = data && typeof data.pending === 'number' && rel === 'F' ? data.pending : catMonths.filter((m) => inRange(m.taxMonth)).reduce((s, m) => s + (m.batches - m.released), 0);
	const pendingNote = pendingBatches > 0 ? {tone: rel === 'T' ? 'info' : 'warn', text: rel === 'T' ? t.note.pendingExcluded(pendingBatches) : t.note.pendingIncluded(pendingBatches)} : null;

	const periodLabel = () => {
		if (report === 'print') return '';
		if (report === 'insurance' || report === 'cost' || (report === 'fund' && scope === 'month')) return monthLabel(month);
		if (report === 'pitq' || (report === 'fund' && scope === 'quarter')) return t.quarterOf(quarter, year);
		return t.yearOf(year);
	};
	const fileTag = () => {
		if (report === 'insurance' || report === 'cost' || (report === 'fund' && scope === 'month')) return month;
		if (report === 'pitq' || (report === 'fund' && scope === 'quarter')) return `${year}Q${quarter}`;
		return year;
	};
	const withType = (rows) => (rows || []).map((r) => Object.assign({}, r, {typeText: t.etype[r.employmentType] || r.employmentType || ''}));
	const typeColumn = {employmentType: {key: 'typeText'}};
	const nameColumn = {employeeName: {nowrap: true, render: (r) => <span class="s4vp-rp-name" title={r.employeeName}>{r.employeeName}</span>}};

	// ---------------------------------------------------------------- từng báo cáo

	const body = [];
	const push = (key, node) => node && body.push(<div key={key} class="s4vp-rp-block">{node}</div>);

	function renderInsurance() {
		const totals = data.totals || {};
		const rows = data.rows || [];
		const d02 = (data.d02 && data.d02.rows) || [];
		const hasC12 = !blank(data.c12Amount);
		const diff = Number(data.c12Difference) || 0;
		const notes = [];
		if (hasC12) notes.push(diff ? {tone: 'error', text: t.note.c12Diff(money(diff), money(data.c12Amount))} : {tone: 'ok', text: t.note.c12Ok(money(data.c12Amount))});
		if ((data.warnings || []).some((w) => w && w.code === 'NO_PREV')) notes.push({tone: 'warn', text: t.note.noPrev});
		(data.warnings || []).filter((w) => w && w.code !== 'NO_PREV' && w.code !== 'C12_DIFF').forEach((w) => notes.push({tone: 'warn', text: localized(w)}));
		const noBook = rows.filter((r) => !String(r.socialInsuranceNbr || '').trim()).length;
		if (noBook) notes.push({tone: 'warn', text: t.note.noSiNumber(noBook)});
		notes.push(pendingNote);
		push('stats', <StatCards cards={[
			{label: t.ins.people, value: num(rows.length), note: t.ins.changes(d02.length)},
			{label: t.ins.wage, value: money(totals.insuranceWage)},
			{label: t.ins.ee, value: money(totals.eeTotal)},
			{label: t.ins.er, value: money(totals.erTotal)},
			{label: t.ins.total, value: money(totals.total), note: t.ins.union(money(totals.erUnionFund), money(totals.eeUnionFee))},
			{label: t.ins.c12, value: hasC12 ? money(diff) : '-', note: hasC12 ? t.ins.c12Of(money(data.c12Amount)) : t.ins.c12None, tone: hasC12 ? (diff ? 'error' : 'ok') : ''},
		]} />);
		push('notes', <Notes notes={notes} />);
		const draft = c12Ref.current === null ? c12 : c12Ref.current;
		const applyC12 = () => {
			const v = toNumber(c12Ref.current === null ? c12 : c12Ref.current);
			c12Ref.current = null;
			go({c12: v === null ? '' : String(v)});
		};
		const c12Tools = (
			<div class="s4vp-rp-tools">
				<MoneyInput
					value={draft}
					decimals={0}
					onInput={(v) => {
						c12Ref.current = v;
						setC12Draft(v);
					}}
					onEnter={applyC12}
					placeholder={t.filter.c12}
					ariaLabel={t.filter.c12}
					width={210}
				/>
				<Button label={t.filter.c12Apply} small={true} onClick={applyC12} />
				{c12 !== '' ? (
					<Button
						label={t.filter.c12Clear}
						small={true}
						kind="ghost"
						onClick={() => {
							c12Ref.current = null;
							go({c12: ''});
						}}
					/>
				) : null}
			</div>
		);
		const showD02 = tab === 'd02';
		push('table', (
			<Card flush={true} label={t.reports.insurance.title}>
				<div class="s4vp-rp-tabs">
					<Tabs value={showD02 ? 'd02' : ''} onPick={(v) => go({tab: v})} items={[{value: '', label: t.ins.tabMain, count: rows.length}, {value: 'd02', label: t.ins.tabD02, count: d02.length}]} />
				</div>
				{showD02 ? (
					<Grid key="d02" columns={gridColumns(data.d02 && data.d02.columns, nameColumn)} rows={d02} empty={t.ins.d02Empty} exportName={`D02-LT_${month}.csv`} label={t.ins.tabD02} />
				) : (
					<Grid key="ins" columns={gridColumns(data.columns, nameColumn)} rows={rows} total={totals} toolbar={c12Tools} exportName={`insurance_${month}.csv`} pin={true} label={t.ins.tabMain} />
				)}
			</Card>
		));
	}

	function renderCost() {
		const totals = data.totals || {};
		const rows = data.rows || [];
		const compared = !!data.glCompared;
		const diffRows = rows.filter((r) => r.difference);
		const diff = Number(totals.difference) || 0;
		const notes = [];
		if (!compared) notes.push({tone: 'warn', text: t.note.glNone});
		else if (diffRows.length) notes.push({tone: 'error', text: t.note.glDiff(diffRows.length, money(diff))});
		else if (rows.length) notes.push({tone: 'ok', text: t.note.glOk});
		(data.warnings || []).filter((w) => w && w.code !== 'GL_DIFF').forEach((w) => notes.push({tone: 'warn', text: localized(w)}));
		notes.push(pendingNote);
		push('stats', <StatCards cards={[
			{label: t.cost.total, value: money(totals.total)},
			{label: t.cost.wages, value: money(totals.wages)},
			{label: t.cost.er, value: money(totals.employerIns)},
			{label: t.cost.other, value: money((Number(totals.accrued13th) || 0) + (Number(totals.contractor) || 0))},
			{label: t.cost.gl, value: compared ? money(totals.gl) : '-', note: compared ? '' : t.cost.notCompared},
			{label: t.cost.diff, value: compared ? money(diff) : '-', tone: compared ? (diffRows.length ? 'error' : 'ok') : ''},
		]} />);
		push('notes', <Notes notes={notes} />);
		const over = {
			accountName: {nowrap: true, render: (r) => <span class="s4vp-rp-name" title={r.accountName}>{r.accountName}</span>},
			difference: {nowrap: true, render: (r) => (r.difference ? <span class="s4vp-rp-bad">{money(r.difference)}</span> : money(r.difference))},
		};
		push('table', (
			<Card flush={true} label={t.reports.cost.title}>
				<Grid columns={gridColumns(data.columns, over)} rows={rows} total={totals} exportName={`cost_${month}.csv`} label={t.reports.cost.title} />
			</Card>
		));
	}

	const taxpayerLines = (s, period) => [
		{label: t.htkk.form, value: s.form},
		{label: t.htkk.taxpayer, value: (s.taxpayer && s.taxpayer.name) || t.htkk.noName},
		{label: t.htkk.taxId, value: (s.taxpayer && s.taxpayer.taxId) || t.htkk.noTaxId},
		{label: t.htkk.period, value: period},
	];
	const taxpayerBlock = (s, period) => (
		<div class="s4vp-rp-sheet-h">
			{taxpayerLines(s, period).map((l, i) => (
				<div key={`l${i}`} class="s4vp-rp-kv">
					<span class="s4vp-small">{l.label}</span>
					<b>{l.value}</b>
				</div>
			))}
		</div>
	);
	const sheetNotes = (s, basisText) => {
		const out = [];
		if ((s.notes || []).indexOf('UNRELEASED_INCLUDED') >= 0) out.push(t.htkk.unreleased);
		out.push(basisText);
		return out;
	};

	function renderPitQuarter() {
		const totals = data.totals || {};
		const rows = data.rows || [];
		const values = data.indicatorValues || {};
		const label = (code) => {
			const hit = (data.indicators || []).find((i) => i.code === `[${code}]`);
			return hit ? `[${code}] ${localized(hit)}` : `[${code}]`;
		};
		const noCode = rows.filter((r) => !String(r.taxCode || '').trim()).length;
		const notes = [];
		if (noCode) notes.push({tone: 'warn', text: t.note.noTaxCode(noCode)});
		(data.warnings || []).forEach((w) => w && notes.push({tone: 'warn', text: localized(w)}));
		notes.push(pendingNote);
		push('stats', <StatCards cards={[
			{label: label(16), value: num(values[16] || 0)},
			{label: label(18), value: num(values[18] || 0)},
			{label: label(21), value: money(values[21] || 0)},
			{label: label(26), value: money(values[26] || 0)},
			{label: label(29), value: money(values[29] || 0)},
		]} />);
		push('notes', <Notes notes={notes} />);
		const indColumns = [
			{key: 'code', label: t.pit.code, nowrap: true},
			{key: 'name', label: t.pit.item},
			{key: 'value', label: t.pit.value, type: 'money', nowrap: true, render: (r) => (r.kind === 'count' ? num(r.value) : money(r.value)), print: (r) => (r.kind === 'count' ? num(r.value) : money(r.value))},
		];
		const indRows = (list) => (list || []).map((i) => Object.assign({}, i, {name: localized(i), kind: i.kind || (Number(String(i.code).replace(/\D/g, '')) <= 20 ? 'count' : 'money')}));
		let content;
		if (tab === 'people') {
			content = <Grid key="people" columns={gridColumns(data.columns, nameColumn)} rows={rows} total={totals} exportName={`05KK-TNCN_${fileTag()}_individuals.csv`} pin={true} label={t.pit.tabPeople} />;
		} else if (tab === 'htkk') {
			if (!sheet) content = <Empty text={t.waiting} />;
			else {
				const sRows = indRows(sheet.rows).map((r) => Object.assign(r, {remark: r.computed === false ? t.htkk.notComputed : ''}));
				const cols = indColumns.concat([{key: 'remark', label: t.pit.remark, render: (r) => (r.remark ? <Badge text={r.remark} tone="warn" /> : '')}]);
				const period = t.quarterOf(sheet.quarter, sheet.year);
				const printIt = () => openSheet(sheetHtml({
					title: t.htkk.title, heading: sheet.form, lines: taxpayerLines(sheet, period).slice(1), columns: indColumns.concat([{key: 'remark', label: t.pit.remark}]), rows: sRows,
					notes: sheetNotes(sheet, t.htkk.basisQuarter), foot: t.htkk.printedAt(today.split('-').reverse().join('/')), printLabel: t.htkk.print,
				}));
				content = (
					<div class="s4vp-rp-sheet">
						{taxpayerBlock(sheet, period)}
						<Notes notes={sheetNotes(sheet, t.htkk.basisQuarter).map((text, i, a) => ({tone: i === a.length - 1 ? 'info' : 'warn', text}))} />
						<Grid key="htkk" columns={cols} rows={sRows} plain={true} exportName={`HTKK_05KK-TNCN_${fileTag()}.csv`} toolbar={<Button label={t.htkk.print} small={true} onClick={printIt} />} label={t.pit.tabHtkk} />
					</div>
				);
			}
		} else {
			content = <div class="s4vp-rp-narrow"><Grid key="ind" columns={indColumns} rows={indRows(data.indicators)} plain={true} exportName={`05KK-TNCN_${fileTag()}_indicators.csv`} label={t.pit.tabInd} /></div>;
		}
		push('table', (
			<Card flush={true} label={t.reports.pitq.title}>
				<div class="s4vp-rp-tabs">
					<Tabs value={tab === 'people' || tab === 'htkk' ? tab : ''} onPick={(v) => go({tab: v})} items={[{value: '', label: t.pit.tabInd}, {value: 'people', label: t.pit.tabPeople, count: rows.length}, {value: 'htkk', label: t.pit.tabHtkk}]} />
				</div>
				{content}
			</Card>
		));
	}

	function renderPitAnnual() {
		const totals = data.totals || {};
		const rows = data.rows || [];
		const noCode = rows.filter((r) => !String(r.taxCode || '').trim()).length;
		const notes = [];
		if (noCode) notes.push({tone: 'warn', text: t.note.noTaxCode(noCode)});
		(data.warnings || []).forEach((w) => w && notes.push({tone: 'warn', text: localized(w)}));
		notes.push(pendingNote);
		push('stats', <StatCards cards={[
			{label: t.pit.people, value: num(rows.length), note: t.pit.bySchedule(rows.filter((r) => r.schedule === '05-1/BK').length, rows.filter((r) => r.schedule === '05-2/BK').length)},
			{label: t.pit.taxable, value: money(totals.taxableIncome)},
			{label: t.pit.family, value: money(totals.familyDeduction)},
			{label: t.pit.assessable, value: money(totals.assessableIncome)},
			{label: t.pit.withheld, value: money(totals.pit)},
		]} />);
		push('notes', <Notes notes={notes} />);
		let content;
		if (tab === 'htkk') {
			if (!sheet) content = <Empty text={t.waiting} />;
			else {
				const period = t.yearOf(sheet.year);
				content = (
					<div class="s4vp-rp-sheet">
						{taxpayerBlock(sheet, period)}
						<Notes notes={sheetNotes(sheet, t.htkk.basis).map((text) => ({tone: 'warn', text}))} />
						{(sheet.tables || []).map((tb) => {
							const name = String(tb.schedule || '').replace('/', '');
							const cols = gridColumns(tb.columns, nameColumn);
							const printIt = () => openSheet(sheetHtml({
								title: t.htkk.title, heading: `${sheet.form} - ${tb.schedule}`, lines: taxpayerLines(sheet, period).slice(1), columns: gridColumns(tb.columns), rows: tb.rows || [],
								notes: sheetNotes(sheet, t.htkk.basis), foot: t.htkk.printedAt(today.split('-').reverse().join('/')), printLabel: t.htkk.print,
							}));
							return (
								<div key={tb.schedule} class="s4vp-rp-sub">
									<div class="s4vp-rp-sub-h">
										<b>{t.htkk.scheduleTitle(tb.schedule, (tb.rows || []).length)}</b>
										<span class="s4vp-small">{t.htkk.scheduleInfo((tb.summary || {}).withheld || 0, (tb.summary || {}).noTaxCode || 0)}</span>
									</div>
									<Grid columns={cols} rows={tb.rows || []} total={tb.totals} height="max(200px, calc(100vh - 520px))" exportName={`HTKK_05QTT-TNCN_${name}_${year}.csv`} toolbar={<Button label={t.htkk.print} small={true} disabled={!(tb.rows || []).length} onClick={printIt} />} pin={true} label={tb.schedule} />
								</div>
							);
						})}
					</div>
				);
			}
		} else {
			content = <Grid key="pita" columns={gridColumns(data.columns, nameColumn)} rows={rows} total={totals} exportName={`${schedule ? `${schedule}BK` : '05-1BK_05-2BK'}_${year}.csv`} pin={true} label={t.pit.tabSchedules} />;
		}
		push('table', (
			<Card flush={true} label={t.reports.pita.title}>
				<div class="s4vp-rp-tabs">
					<Tabs value={tab === 'htkk' ? 'htkk' : ''} onPick={(v) => go({tab: v})} items={[{value: '', label: t.pit.tabSchedules, count: rows.length}, {value: 'htkk', label: t.pit.tabData}]} />
				</div>
				{content}
			</Card>
		));
	}

	function renderFund() {
		const totals = data.totals || {};
		const rows = withType(data.rows);
		const byType = {};
		(data.byType || []).forEach((x) => x && (byType[x.employmentType] = x));
		const notes = [];
		(data.warnings || []).forEach((w) => {
			if (!w) return;
			notes.push({tone: 'warn', text: w.code === 'NO_DEPARTMENT' ? t.note.noDepartment(w.count) : localized(w)});
		});
		notes.push(pendingNote);
		if (rows.length) notes.push({tone: 'info', text: t.note.deptNow});
		push('stats', <StatCards cards={[
			{label: t.fund.people, value: num(totals.headcount || 0), note: t.fund.byType(num((byType.E || {}).headcount || 0), num((byType.C || {}).headcount || 0))},
			{label: t.fund.gross, value: money(totals.gross)},
			{label: t.fund.net, value: money(totals.net)},
			{label: t.fund.er, value: money((Number(totals.erIns) || 0) + (Number(totals.accrued13) || 0))},
			{label: t.fund.cost, value: money(totals.cost), note: t.fund.costNote},
		]} />);
		push('notes', <Notes notes={notes} />);
		const over = Object.assign({departmentName: {nowrap: true, render: (r) => <span class="s4vp-rp-name" title={r.departmentName}>{r.departmentName || '-'}</span>}}, typeColumn);
		push('table', (
			<Card flush={true} label={t.reports.fund.title}>
				<Grid columns={gridColumns(data.columns, over)} rows={rows} total={Object.assign({typeText: ''}, totals)} exportName={`payroll-fund_${fileTag()}.csv`} label={t.reports.fund.title} />
			</Card>
		));
	}

	function renderPitLedger() {
		const totals = data.totals || {};
		const rows = withType(data.rows);
		const summary = data.summary || {};
		const notes = [];
		(data.warnings || []).forEach((w) => {
			if (!w) return;
			notes.push({tone: 'warn', text: w.code === 'NO_TAX_CODE' ? t.note.noTaxCodeWithheld(w.count) : w.code === 'NEGATIVE_PIT' ? t.note.negativePit(w.count) : localized(w)});
		});
		notes.push(pendingNote);
		push('stats', <StatCards cards={[
			{label: t.pit.people, value: num(summary.people || 0)},
			{label: t.pit.withheldPeople, value: num(summary.withheld || 0)},
			{label: t.pit.withheld, value: money(summary.pit)},
			{label: t.pit.taxable, value: money(summary.taxableIncome)},
		]} />);
		push('notes', <Notes notes={notes} />);
		const taxable = tab === 'taxable';
		const over = Object.assign({}, nameColumn, typeColumn);
		const view = <Chips value={taxable ? 'taxable' : ''} onPick={(v) => go({tab: v})} label={t.reports.pitLedger.title} items={[{value: '', label: t.pit.viewPit}, {value: 'taxable', label: t.pit.viewTaxable}]} />;
		push('table', (
			<Card flush={true} label={t.reports.pitLedger.title}>
				<Grid key={taxable ? 'taxable' : 'pit'} columns={gridColumns(taxable ? data.taxableColumns : data.columns, over)} rows={rows} total={Object.assign({typeText: '', taxCode: ''}, totals)} toolbar={view} exportName={`pit-ledger_${taxable ? 'taxable_' : ''}${year}.csv`} pin={true} label={t.reports.pitLedger.title} />
			</Card>
		));
	}

	function renderPrint() {
		const rows = (Array.isArray(data.batches) ? data.batches : []).filter((b) => b && b.calculated && b.status !== 'V').map((b) => Object.assign({}, b, {statusText: t.status[b.status] || b.status || ''}));
		const open = (b, doc) => window.open(printUrl(b.id, doc), '_blank');
		const columns = [
			{key: 'name', label: t.print.number, nowrap: true, render: (r) => <Button kind="link" label={r.name || r.id} title={t.print.openRun} onClick={() => app.go('payrollRun', {id: r.id})} />},
			{key: 'periodName', label: t.print.period, nowrap: true},
			{key: 'statusText', label: t.print.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={STATUS_TONE[r.status] || 'muted'} />},
			{key: 'description', label: ''},
			{key: 'emp_count', label: t.print.count, type: 'number', nowrap: true},
			{key: 'net', label: t.print.net, type: 'money', nowrap: true},
			{
				key: 'docs', label: t.print.docs, nowrap: true, csv: false, noTotal: true,
				render: (r) => (
					<span class="s4vp-rp-docs">
						<Button small={true} label={t.print.payslip} onClick={() => open(r, 'payslip')} />
						<Button small={true} label={t.print.payment} onClick={() => open(r, 'payment')} />
						{r.ctr_net ? <Button small={true} label={t.print.contractor} onClick={() => open(r, 'contractor')} /> : null}
					</span>
				),
			},
		];
		push('table', (
			<Card flush={true} label={t.reports.print.title}>
				<Grid columns={columns} rows={rows} empty={t.print.empty} placeholder={t.print.search} label={t.reports.print.title} />
			</Card>
		));
	}

	if (data) {
		try {
			if (report === 'insurance') renderInsurance();
			else if (report === 'cost') renderCost();
			else if (report === 'pitq') renderPitQuarter();
			else if (report === 'pita') renderPitAnnual();
			else if (report === 'fund') renderFund();
			else if (report === 'pitLedger') renderPitLedger();
			else if (report === 'print') renderPrint();
		} catch (e) {
			// Dữ liệu sai dạng không được làm sập cả màn hình: hiện khung trống
			body.length = 0;
		}
	}

	const info = t.reports[report];
	const period = periodLabel();
	return (
		<Page>
			<PageHeader back={{label: t.back, onClick: () => app.go('reportsHub', {})}} title={period ? `${info.title} - ${period}` : info.title} sub={report === 'print' ? t.print.sub : info.desc} actions={controls} />
			<div class="s4vp-rp">
				{body.length ? body : (
					<Card>
						<Empty text={!subsidiary ? t.noSubsidiary : pending || app.busy ? t.waiting : t.empty} />
					</Card>
				)}
			</div>
		</Page>
	);
}
