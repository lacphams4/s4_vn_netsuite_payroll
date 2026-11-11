/**
 * Tạm ứng lương (giao diện bản 2, docs/UI_V2.md mục 14). Theo việc: HR lập đề nghị (một hoặc nhiều người trong một hộp
 * thoại), kế toán ghi sổ Nợ 141 / Có tiền, bảng lương kỳ sau tự cấn trừ. Thẻ số liệu và chip lọc đưa lên trước các phiếu
 * chờ ghi sổ và phiếu còn dư; bấm một dòng mở khung chi tiết bên phải (6:4): thông tin phiếu, cấn trừ theo bảng lương
 * (đã ghi sổ và đang chờ), bút toán, nút thao tác theo trạng thái và vai trò.
 *
 * Đọc: GET advancesView (api/AdvancesV2.js), GET employeeSearch (tìm nhân viên phía máy chủ, tối đa 20 dòng).
 * Ghi: action cũ createAdvance, removeHoldAdvance, releaseAdvance (HR không được ghi sổ - ma trận quyền của RESTlet).
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post, openRecord, openJournal, errorText} from '../lib/api.js';
import {money, fmtDate, toNumber, localToday} from '../lib/format.js';
import {pick, serverText} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Table, Badge, Chips, StatCards, AutoSelect, Field, TextInput, MoneyInput, DateInput, Dialog, SidePanel, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		title: 'Tạm ứng lương',
		sub: 'HR lập phiếu, kế toán ghi sổ Nợ 141 / Có tiền, bảng lương kỳ sau tự cấn trừ. Bấm một dòng để xem chi tiết.',
		newAdvance: 'Tạo tạm ứng',
		refresh: 'Tải lại',
		legacy: 'Màn hình cũ',
		loading: 'Đang tải...',
		working: 'Đang xử lý...',
		noSubsidiary: 'Chưa chọn công ty con.',
		search: 'Tìm số phiếu, nhân viên, số tiền, trạng thái',
		empty: 'Chưa có phiếu tạm ứng nào. Bấm Tạo tạm ứng để lập phiếu.',
		emptyFilter: 'Không có phiếu nào ở trạng thái này.',
		total: (n) => `Tổng ${n} phiếu`,
		status: {H: 'Tạm giữ', B: 'Chờ ghi sổ', O: 'Đang cấn trừ', C: 'Đã tất toán'},
		chips: {all: 'Tất cả', label: 'Lọc theo trạng thái'},
		cards: {
			pendingPost: 'Chờ ghi sổ',
			pendingPostNote: (n, hold) => `${n} phiếu chờ kế toán ghi sổ${hold ? ` - ${hold} phiếu còn tạm giữ` : ''}`,
			open: 'Đang mở chờ cấn trừ',
			openValue: (n) => `${n} phiếu`,
			openNote: (amount) => `${amount} đã nằm trong bảng lương chưa ghi sổ`,
			openNoteNone: 'Chưa có bảng lương nào đang cấn trừ',
			balance: 'Tổng dư tạm ứng',
			balanceNote: 'Số còn phải thu qua lương',
			settled: 'Đã tất toán trong kỳ',
			settledValue: (n) => `${n} phiếu`,
			settledNote: (period, amount) => `Kỳ ${period} - ${amount}`,
			settledNoPeriod: 'Không có kỳ lương chứa hôm nay',
		},
		cols: {number: 'Số', date: 'Ngày', employee: 'Nhân viên', department: 'Phòng ban', amount: 'Số tiền', offset: 'Đã cấn trừ', balance: 'Còn lại', status: 'Trạng thái', due: 'Kỳ cấn trừ', memo: 'Diễn giải', journal: 'Bút toán'},
		due: {
			inBatch: (batch, period) => (period ? `${batch} (${period})` : batch),
			expected: (period) => `Dự kiến ${period}`,
		},
		detail: {
			close: 'Đóng',
			openRecord: 'Mở bản ghi',
			removeHold: 'Bỏ tạm giữ',
			release: 'Ghi sổ',
			date: 'Ngày',
			amount: 'Số tiền',
			offset: 'Đã cấn trừ',
			balance: 'Còn lại',
			cashAccount: 'Tài khoản tiền',
			noCashAccount: 'Chưa chọn',
			project: 'Dự án',
			memo: 'Diễn giải',
			journal: 'Bút toán',
			noJournal: 'Chưa ghi sổ',
			inOpenBatches: 'Đang nằm trong bảng lương chưa ghi sổ',
			nextPeriod: 'Phần còn lại dự kiến trừ vào kỳ',
			noNextPeriod: 'Chưa có kỳ lương mở phù hợp',
			offsets: 'Cấn trừ theo bảng lương',
			offsetsEmpty: 'Chưa có bảng lương nào cấn trừ phiếu này.',
			offsetsSearch: 'Tìm bảng lương, kỳ, số tiền',
			offsetsTotal: 'Tổng',
			batch: 'Bảng lương',
			period: 'Kỳ',
			offsetAmount: 'Số cấn trừ',
			state: 'Tình trạng',
			posted: 'Đã ghi sổ',
			pending: 'Chờ ghi sổ bảng lương',
			next: {
				H: 'Phiếu đang tạm giữ. Kiểm tra số tiền, chọn tài khoản tiền rồi bỏ tạm giữ để chuyển kế toán ghi sổ.',
				B: 'Phiếu chờ kế toán ghi sổ: hệ thống lập bút toán Nợ 141 / Có tài khoản tiền theo ngày phiếu.',
				O: 'Đã chi tạm ứng. Bảng lương có kỳ kết thúc từ ngày phiếu trở đi sẽ tự cấn trừ vào thực lĩnh.',
				C: 'Phiếu đã cấn trừ hết qua bảng lương.',
			},
			needCash: 'Chưa chọn tài khoản tiền: mở bản ghi, chọn tài khoản tiền rồi quay lại bỏ tạm giữ.',
			releaseAcctOnly: 'Chỉ kế toán (hoặc quản trị) được ghi sổ tạm ứng.',
			readOnly: 'Vai trò của bạn chỉ được xem.',
		},
		confirm: {
			removeHold: (nbr, emp, amount) => `Bỏ tạm giữ phiếu ${nbr} (${emp}, ${amount})? Phiếu chuyển sang Chờ ghi sổ và không sửa lại được trên màn hình này.`,
			release: (nbr, emp, amount, account) => `Ghi sổ phiếu ${nbr} (${emp}, ${amount})? Hệ thống lập bút toán Nợ 141 / Có ${account}.`,
		},
		done: {
			removeHold: (nbr) => `Đã bỏ tạm giữ phiếu ${nbr}. Phiếu đang chờ kế toán ghi sổ.`,
			release: (nbr) => `Đã ghi sổ phiếu ${nbr}.`,
			created: (n) => `Đã tạo ${n} phiếu tạm ứng ở trạng thái tạm giữ.`,
			partly: (ok, bad) => `Đã tạo ${ok} phiếu, ${bad} phiếu lỗi còn lại trong hộp thoại.`,
		},
		form: {
			title: 'Tạo tạm ứng',
			date: 'Ngày tạm ứng',
			cashAccount: 'Tài khoản tiền',
			cashLater: 'Chọn sau trên bản ghi',
			cashHint: 'Cần có trước khi bỏ tạm giữ',
			amount: 'Số tiền mỗi người',
			amountHint: 'Cho dòng không nhập số riêng',
			memo: 'Diễn giải chung',
			memoHint: 'Ví dụ: Tạm ứng lương tháng 03/2027',
			find: 'Thêm nhân viên',
			findPlaceholder: 'Gõ mã hoặc họ tên (có dấu), bấm kết quả để thêm - Enter thêm kết quả đầu tiên',
			searching: 'Đang tìm...',
			noResult: 'Không tìm thấy nhân viên có hồ sơ lương khớp.',
			more: 'Còn kết quả khác - gõ thêm để thu hẹp.',
			added: 'đã thêm',
			results: 'Kết quả tìm nhân viên',
			lines: 'Danh sách tạm ứng',
			noLines: 'Chưa chọn nhân viên nào.',
			employee: 'Nhân viên',
			lineAmount: 'Số tiền',
			lineMemo: 'Diễn giải',
			amountOf: (name) => `Số tiền của ${name}`,
			memoOf: (name) => `Diễn giải của ${name}`,
			remove: 'Bỏ',
			removeOf: (name) => `Bỏ ${name} khỏi danh sách`,
			outstanding: (n, amount) => `Đang có ${n} phiếu chưa tất toán, còn ${amount}`,
			sum: (n, amount) => `${n} người - tổng ${amount}`,
			create: (n) => (n > 1 ? `Tạo ${n} phiếu` : 'Tạo phiếu'),
			cancel: 'Hủy',
			creating: (n) => `Đang tạo ${n} phiếu tạm ứng...`,
			errDate: 'Ngày không hợp lệ (dd/mm/yyyy).',
			errAmount: 'Số tiền phải lớn hơn 0.',
			errNoLines: 'Chọn ít nhất một nhân viên.',
			errFix: 'Còn ô chưa hợp lệ, xem dòng báo đỏ.',
			failed: 'Không tạo được phiếu.',
			noRole: 'Vai trò của bạn không được lập phiếu tạm ứng.',
		},
	},
	en: {
		title: 'Payroll advances',
		sub: 'HR creates advances, accounting posts Dr 141 / Cr cash, the next payroll offsets them. Click a row for details.',
		newAdvance: 'New advance',
		refresh: 'Refresh',
		legacy: 'Previous screen',
		loading: 'Loading...',
		working: 'Working...',
		noSubsidiary: 'No subsidiary selected.',
		search: 'Search number, employee, amount, status',
		empty: 'No advances yet. Click New advance to create one.',
		emptyFilter: 'No advances in this status.',
		total: (n) => `Total of ${n} advances`,
		status: {H: 'On hold', B: 'Pending release', O: 'Open', C: 'Closed'},
		chips: {all: 'All', label: 'Filter by status'},
		cards: {
			pendingPost: 'Pending release',
			pendingPostNote: (n, hold) => `${n} advances waiting for accounting${hold ? ` - ${hold} still on hold` : ''}`,
			open: 'Open, to be offset',
			openValue: (n) => `${n} advances`,
			openNote: (amount) => `${amount} already in unreleased payroll batches`,
			openNoteNone: 'No payroll batch is offsetting yet',
			balance: 'Total advance balance',
			balanceNote: 'Still to be recovered through payroll',
			settled: 'Closed this period',
			settledValue: (n) => `${n} advances`,
			settledNote: (period, amount) => `Period ${period} - ${amount}`,
			settledNoPeriod: 'No pay period contains today',
		},
		cols: {number: 'Number', date: 'Date', employee: 'Employee', department: 'Department', amount: 'Amount', offset: 'Offset', balance: 'Balance', status: 'Status', due: 'Offset period', memo: 'Description', journal: 'Journal'},
		due: {
			inBatch: (batch, period) => (period ? `${batch} (${period})` : batch),
			expected: (period) => `Expected ${period}`,
		},
		detail: {
			close: 'Close',
			openRecord: 'Open record',
			removeHold: 'Remove hold',
			release: 'Release',
			date: 'Date',
			amount: 'Amount',
			offset: 'Offset',
			balance: 'Balance',
			cashAccount: 'Cash account',
			noCashAccount: 'Not selected',
			project: 'Project',
			memo: 'Description',
			journal: 'Journal',
			noJournal: 'Not posted',
			inOpenBatches: 'In unreleased payroll batches',
			nextPeriod: 'Remainder expected in period',
			noNextPeriod: 'No suitable open pay period',
			offsets: 'Offsets by payroll batch',
			offsetsEmpty: 'No payroll batch has offset this advance yet.',
			offsetsSearch: 'Search batch, period, amount',
			offsetsTotal: 'Total',
			batch: 'Payroll batch',
			period: 'Period',
			offsetAmount: 'Offset amount',
			state: 'State',
			posted: 'Posted',
			pending: 'Waiting for payroll release',
			next: {
				H: 'The advance is on hold. Check the amount, select the cash account, then remove the hold to send it to accounting.',
				B: 'Waiting for accounting to release: the system creates a journal Dr 141 / Cr cash account on the advance date.',
				O: 'The advance is paid. Payroll batches whose period ends on or after the advance date offset it against net pay.',
				C: 'The advance is fully offset through payroll.',
			},
			needCash: 'No cash account: open the record, select the cash account, then come back to remove the hold.',
			releaseAcctOnly: 'Only accounting (or an administrator) can release advances.',
			readOnly: 'Your role is view only.',
		},
		confirm: {
			removeHold: (nbr, emp, amount) => `Remove the hold on advance ${nbr} (${emp}, ${amount})? It moves to Pending release and can no longer be changed on this screen.`,
			release: (nbr, emp, amount, account) => `Release advance ${nbr} (${emp}, ${amount})? The system creates a journal Dr 141 / Cr ${account}.`,
		},
		done: {
			removeHold: (nbr) => `Hold removed on advance ${nbr}. It is waiting for accounting to release.`,
			release: (nbr) => `Advance ${nbr} released.`,
			created: (n) => `Created ${n} advances on hold.`,
			partly: (ok, bad) => `Created ${ok} advances; ${bad} failed and remain in the dialog.`,
		},
		form: {
			title: 'New advance',
			date: 'Advance date',
			cashAccount: 'Cash account',
			cashLater: 'Select later on the record',
			cashHint: 'Required before removing the hold',
			amount: 'Amount per employee',
			amountHint: 'For rows without their own amount',
			memo: 'Common description',
			memoHint: 'For example: Payroll advance 03/2027',
			find: 'Add employees',
			findPlaceholder: 'Type an ID or a name, click a result to add it - Enter adds the first result',
			searching: 'Searching...',
			noResult: 'No employee with a payroll profile matches.',
			more: 'More results exist - type more to narrow down.',
			added: 'added',
			results: 'Employee search results',
			lines: 'Advances to create',
			noLines: 'No employee selected yet.',
			employee: 'Employee',
			lineAmount: 'Amount',
			lineMemo: 'Description',
			amountOf: (name) => `Amount for ${name}`,
			memoOf: (name) => `Description for ${name}`,
			remove: 'Remove',
			removeOf: (name) => `Remove ${name} from the list`,
			outstanding: (n, amount) => `${n} advances not closed yet, ${amount} outstanding`,
			sum: (n, amount) => `${n} employees - total ${amount}`,
			create: (n) => (n > 1 ? `Create ${n} advances` : 'Create advance'),
			cancel: 'Cancel',
			creating: (n) => `Creating ${n} advances...`,
			errDate: 'Invalid date (dd/mm/yyyy).',
			errAmount: 'The amount must be greater than zero.',
			errNoLines: 'Select at least one employee.',
			errFix: 'Some fields are invalid, see the rows in red.',
			failed: 'The advance could not be created.',
			noRole: 'Your role is not allowed to create advances.',
		},
	},
};

const TONE = {H: 'muted', B: 'warn', O: 'info', C: 'ok'};
const STATUSES = ['H', 'B', 'O', 'C'];
const RECORD_TYPE = 'customrecord_s4vp_advance';
const SEARCH_DELAY = 300;

const validIso = (v) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
	if (!m) return false;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
};
const empLabel = (r) => `${r.employeeCode || r.code || ''} ${r.employeeName || r.name || ''}`.trim();
const list = (v) => (Array.isArray(v) ? v : []);

export default function AdvancesView({app}) {
	const t = pick(TEXT);
	const boot = app.boot || {};
	const user = boot.user || {};
	const subsidiary = app.subsidiary || '';
	// Ma trận quyền của RESTlet: HR và kế toán lập phiếu, bỏ tạm giữ; chỉ kế toán (và administrator) ghi sổ
	const isAdmin = user.role === 'administrator';
	const isAcct = !!user.isAccountant || user.role === 'customrole_s4vp_accountant';
	const canEdit = isAdmin || !!user.isHr || isAcct;
	const canRelease = isAdmin || isAcct;

	const [data, setData] = useState(null);
	const [filter, setFilter] = useState('');
	const [selected, setSelected] = useState(String((app.route && app.route.params && app.route.params.id) || ''));
	const [dialog, setDialog] = useState(false);
	const formRef = useRef({date: localToday(), cashAccount: '', amount: '', memo: ''});
	const [form, setForm] = useState(formRef.current);
	const linesRef = useRef([]);
	const [lines, setLines] = useState(linesRef.current);
	const [errors, setErrors] = useState({});
	const [query, setQuery] = useState('');
	const [found, setFound] = useState({items: [], more: false, state: ''});
	const alive = useRef(true);
	const request = useRef(0);
	const searchSeq = useRef(0);
	const timer = useRef(null);

	const load = () => {
		if (!subsidiary) return Promise.resolve();
		request.current += 1;
		const mine = request.current;
		return app.run(t.loading, call({action: 'advancesView', subsidiary})).then((r) => {
			if (!alive.current || mine !== request.current || !r) return;
			setData(r);
		});
	};

	useEffect(() => {
		alive.current = true;
		load();
		return () => {
			alive.current = false;
			if (timer.current) clearTimeout(timer.current);
		};
	}, [subsidiary]);

	const view = data || {};
	const counts = view.counts || {};
	const cards = view.cards || {};
	const all = list(view.rows);

	// ------------------------------------------------------------------ thao tác trên một phiếu
	const act = (action, row, doneText) => {
		const work = post({action, id: row.id}).then((r) => {
			// Lỗi phân quyền của action cũ có thể trả ở khóa error / errorVi (không ném)
			if (r && r.error) throw {message: serverText(r.error, r.errorVi)};
			return r || {ok: true};
		});
		app.run(t.working, work).then((r) => {
			if (!r || !alive.current) return;
			load().then(() => alive.current && app.notify(doneText, 'ok'));
		});
	};
	const removeHold = (r) => app.confirm(t.confirm.removeHold(r.name, empLabel(r), money(r.amount)), () => act('removeHoldAdvance', r, t.done.removeHold(r.name)));
	const release = (r) => app.confirm(t.confirm.release(r.name, empLabel(r), money(r.amount), r.cashAccountName || t.detail.cashAccount), () => act('releaseAdvance', r, t.done.release(r.name)));

	// ------------------------------------------------------------------ hộp thoại tạo tạm ứng
	const setField = (k) => (v) => {
		formRef.current = Object.assign({}, formRef.current, {[k]: v});
		setForm(formRef.current);
	};
	const putLines = (next) => {
		linesRef.current = next;
		setLines(next);
	};
	const openDialog = () => {
		formRef.current = {date: localToday(), cashAccount: '', amount: '', memo: ''};
		setForm(formRef.current);
		putLines([]);
		setErrors({});
		setQuery('');
		setFound({items: [], more: false, state: ''});
		setDialog(true);
	};
	const search = (text) => {
		setQuery(text);
		if (timer.current) clearTimeout(timer.current);
		searchSeq.current += 1;
		const mine = searchSeq.current;
		const q = String(text || '').trim();
		if (!q) {
			setFound({items: [], more: false, state: ''});
			return;
		}
		setFound({items: found.items, more: false, state: 'searching'});
		timer.current = setTimeout(() => {
			call({action: 'employeeSearch', subsidiary, q}).then(
				(r) => {
					if (!alive.current || mine !== searchSeq.current) return;
					const items = list(r && r.items);
					setFound({items, more: !!(r && r.more), state: items.length ? '' : 'none'});
				},
				(e) => {
					if (!alive.current || mine !== searchSeq.current) return;
					setFound({items: [], more: false, state: 'error', error: errorText(e)});
				}
			);
		}, SEARCH_DELAY);
	};
	const addLine = (e) => {
		if (!e || linesRef.current.some((l) => l.id === String(e.id))) return;
		putLines(linesRef.current.concat([{id: String(e.id), code: e.code || '', name: e.name || '', department: e.department || '', amount: '', memo: ''}]));
	};
	const setLine = (id, k) => (v) => putLines(linesRef.current.map((l) => (l.id === id ? Object.assign({}, l, {[k]: v}) : l)));
	const removeLine = (id) => putLines(linesRef.current.filter((l) => l.id !== id));
	const amountOf = (l, v) => {
		const own = String(l.amount || '').trim();
		return toNumber(own ? own : v.amount);
	};
	const validate = (v, rows) => {
		const out = {lines: {}};
		if (!validIso(v.date)) out.date = t.form.errDate;
		if (!rows.length) out.general = t.form.errNoLines;
		rows.forEach((l) => {
			if (!(amountOf(l, v) > 0)) out.lines[l.id] = t.form.errAmount;
		});
		out.count = (out.date ? 1 : 0) + (out.general ? 1 : 0) + Object.keys(out.lines).length;
		if (out.count && !out.general) out.general = t.form.errFix;
		return out;
	};
	const createAll = () => {
		const v = formRef.current;
		const rows = linesRef.current;
		const errs = validate(v, rows);
		setErrors(errs);
		if (errs.count) return;
		const created = [];
		const failed = {};
		// Từng phiếu một lượt gọi createAdvance (action cũ); phiếu lỗi ở lại hộp thoại kèm lý do, phiếu đã tạo không tạo lại
		let chain = Promise.resolve();
		rows.forEach((l) => {
			chain = chain.then(() =>
				post({action: 'createAdvance', subsidiary, employee: l.id, docDate: v.date, amount: amountOf(l, v), cashAccount: v.cashAccount || null, memo: String(l.memo || '').trim() || String(v.memo || '').trim()}).then(
					(r) => {
						if (r && r.error) failed[l.id] = serverText(r.error, r.errorVi) || t.form.failed;
						else created.push(String((r && r.id) || ''));
					},
					(e) => {
						failed[l.id] = errorText(e) || t.form.failed;
					}
				)
			);
		});
		app.run(t.form.creating(rows.length), chain.then(() => ({created, failed}))).then((r) => {
			if (!r || !alive.current) return;
			const bad = Object.keys(r.failed).length;
			if (bad) {
				putLines(linesRef.current.filter((l) => r.failed[l.id]));
				setErrors({lines: r.failed, general: t.done.partly(r.created.length, bad), count: bad});
			} else setDialog(false);
			if (!r.created.length) return;
			setFilter('');
			if (!bad && r.created[0]) setSelected(r.created[0]);
			load().then(() => alive.current && app.notify(bad ? t.done.partly(r.created.length, bad) : t.done.created(r.created.length), bad ? 'warn' : 'ok'));
		});
	};

	// ------------------------------------------------------------------ bảng
	const dueText = (r) => {
		if (r.status !== 'O') return '';
		const parts = list(r.pending).map((p) => t.due.inBatch(p.batchNbr, p.period));
		if (r.nextPeriod && r.nextPeriod.name) parts.push(t.due.expected(r.nextPeriod.name));
		return parts.join(', ');
	};
	// Chữ hiển thị (trạng thái, ngày dd/mm/yyyy, kỳ cấn trừ) đưa vào dòng để ô tìm khớp được
	const rows = all
		.filter((r) => !filter || r.status === filter)
		.map((r) => Object.assign({}, r, {statusText: t.status[r.status] || r.status || '', dateText: fmtDate(r.date), dueText: dueText(r), journalText: r.journal ? r.journalNo || `JE ${r.journal}` : ''}));
	const current = selected ? rows.find((r) => String(r.id) === String(selected)) || null : null;
	const total = rows.length > 1 ? rows.reduce((acc, r) => {
		['amount', 'offset', 'balance'].forEach((k) => (acc[k] += Number(r[k]) || 0));
		return acc;
	}, {name: t.total(rows.length), amount: 0, offset: 0, balance: 0}) : null;
	const wide = !current;
	const columns = [
		{key: 'name', label: t.cols.number, nowrap: true, render: (r) => <span class="s4vp-link">{r.name || r.id}</span>},
		{key: 'date', label: t.cols.date, type: 'date', nowrap: true},
		{key: 'employeeName', label: t.cols.employee, render: (r) => (
			<span class="s4vp-adv-who">
				<span class="s4vp-adv-emp-n">{r.employeeName || r.employee || ''}</span>
				<span class="s4vp-small">{r.employeeCode || ''}</span>
			</span>
		)},
		wide ? {key: 'department', label: t.cols.department} : null,
		{key: 'amount', label: t.cols.amount, type: 'money', nowrap: true},
		{key: 'offset', label: t.cols.offset, type: 'money', nowrap: true},
		{key: 'balance', label: t.cols.balance, type: 'money', nowrap: true},
		{key: 'status', label: t.cols.status, nowrap: true, render: (r) => <Badge text={r.statusText} tone={TONE[r.status] || 'muted'} />},
		wide ? {key: 'dueText', label: t.cols.due, render: (r) => <span class="s4vp-small">{r.dueText}</span>} : null,
		wide ? {key: 'memo', label: t.cols.memo, render: (r) => <span class="s4vp-adv-memo" title={r.memo || ''}>{r.memo || ''}</span>} : null,
		wide ? {key: 'journal', label: t.cols.journal, nowrap: true, noRowClick: true, render: (r) => (r.journal ? <Button kind="link" label={r.journalText} onClick={() => openJournal(r.journal)} /> : '')} : null,
	];
	const chipItems = [{value: '', label: t.chips.all, count: counts.all || 0}].concat(STATUSES.map((s) => ({value: s, label: t.status[s], count: counts[s] || 0, tone: s === 'B' && counts.B ? 'warn' : ''})));

	const pendingPost = cards.pendingPost || {};
	const openCard = cards.open || {};
	const settled = cards.settled || {};
	const statCards = [
		{key: 'post', label: t.cards.pendingPost, value: money(pendingPost.amount || 0), note: t.cards.pendingPostNote(pendingPost.count || 0, (cards.onHold || {}).count || 0), tone: pendingPost.count ? 'warn' : ''},
		{key: 'open', label: t.cards.open, value: t.cards.openValue(openCard.count || 0), note: openCard.pending ? t.cards.openNote(money(openCard.pending)) : t.cards.openNoteNone},
		{key: 'bal', label: t.cards.balance, value: money(openCard.balance || 0), note: t.cards.balanceNote},
		{key: 'done', label: t.cards.settled, value: t.cards.settledValue(settled.count || 0), note: settled.period ? t.cards.settledNote(settled.period, money(settled.amount || 0)) : t.cards.settledNoPeriod, tone: settled.count ? 'ok' : ''},
	];

	// ------------------------------------------------------------------ khung chi tiết
	const line = (label, value, strong) => (
		<div class="s4vp-line" style={strong ? {fontWeight: '700'} : {}}>
			<span class="s4vp-muted">{label}</span>
			<span class="s4vp-adv-val">{value}</span>
		</div>
	);
	const detailPanel = (r) => {
		const offsets = list(r.history)
			.map((h, i) => ({id: `h${i}`, batch: h.batch, batchNbr: h.batchNbr || h.batch, period: h.period || '', amount: h.amount, stateText: t.detail.posted, tone: 'ok'}))
			.concat(list(r.pending).map((p, i) => ({id: `p${i}`, batch: p.batch, batchNbr: p.batchNbr || p.batch, period: p.period || '', amount: p.amount, stateText: t.detail.pending, tone: 'warn'})));
		const offsetTotal = offsets.length > 1 ? {batchNbr: t.detail.offsetsTotal, amount: offsets.reduce((s, o) => s + (Number(o.amount) || 0), 0)} : null;
		const buttons = [];
		let reason = '';
		if (r.status === 'H') {
			if (!canEdit) reason = t.detail.readOnly;
			else if (!r.cashAccount) reason = t.detail.needCash;
			buttons.push(<Button label={t.detail.removeHold} kind="primary" disabled={!!reason || !!app.busy} title={reason} onClick={() => removeHold(r)} />);
		} else if (r.status === 'B') {
			if (!canRelease) reason = t.detail.releaseAcctOnly;
			buttons.push(<Button label={t.detail.release} kind="primary" disabled={!!reason || !!app.busy} title={reason} onClick={() => release(r)} />);
		}
		buttons.push(<Button label={t.detail.openRecord} onClick={() => openRecord(RECORD_TYPE, r.id)} />);
		const free = Math.max(0, (Number(r.balance) || 0) - (Number(r.pendingAmount) || 0));
		return (
			<SidePanel title={r.name || String(r.id)} sub={[empLabel(r), r.department].filter(Boolean).join(' · ')} onClose={() => setSelected('')}>
				<div class="s4vp-adv-state">
					<Badge text={r.statusText} tone={TONE[r.status] || 'muted'} large={true} />
					<span class="s4vp-small">{t.detail.next[r.status] || ''}</span>
				</div>
				<div class="s4vp-actions s4vp-adv-acts">{buttons.map((b, i) => <span key={`b${i}`} style={{display: 'contents'}}>{b}</span>)}</div>
				{reason ? <div class="s4vp-adv-reason" role="note">{reason}</div> : null}
				<div class="s4vp-adv-info">
					{line(t.detail.date, fmtDate(r.date))}
					{line(t.detail.amount, money(r.amount), true)}
					{r.status === 'O' || r.status === 'C' ? line(t.detail.offset, money(r.offset)) : null}
					{r.status === 'O' || r.status === 'C' ? line(t.detail.balance, money(r.balance), true) : null}
					{r.status === 'O' && r.pendingAmount ? line(t.detail.inOpenBatches, money(r.pendingAmount)) : null}
					{r.status === 'O' && free > 0 ? line(t.detail.nextPeriod, r.nextPeriod && r.nextPeriod.name ? r.nextPeriod.name : t.detail.noNextPeriod) : null}
					{line(t.detail.cashAccount, r.cashAccountName || (r.cashAccount ? String(r.cashAccount) : t.detail.noCashAccount))}
					{r.project ? line(t.detail.project, r.projectName || String(r.project)) : null}
					{r.memo ? line(t.detail.memo, r.memo) : null}
					{line(t.detail.journal, r.journal ? <Button kind="link" label={r.journalText} onClick={() => openJournal(r.journal)} /> : t.detail.noJournal)}
				</div>
				<div class="s4vp-adv-sub">{t.detail.offsets}</div>
				{offsets.length ? (
					<div class="s4vp-adv-offsets">
						<Table
							label={t.detail.offsets}
							columns={[
								{key: 'batchNbr', label: t.detail.batch, nowrap: true, render: (o) => <span class="s4vp-link">{o.batchNbr}</span>},
								{key: 'period', label: t.detail.period, nowrap: true},
								{key: 'amount', label: t.detail.offsetAmount, type: 'money', nowrap: true},
								{key: 'stateText', label: t.detail.state, render: (o) => <Badge text={o.stateText} tone={o.tone} />},
							]}
							rows={offsets}
							keyOf={(o) => o.id}
							onRowClick={(o) => o.batch && app.go('payrollRun', {id: o.batch})}
							total={offsetTotal}
							search={true}
							searchPlaceholder={t.detail.offsetsSearch}
						/>
					</div>
				) : (
					<Empty text={t.detail.offsetsEmpty} />
				)}
			</SidePanel>
		);
	};

	// ------------------------------------------------------------------ hộp thoại
	const outstanding = (empId) => {
		const mine = all.filter((r) => String(r.employee) === String(empId) && r.status !== 'C');
		if (!mine.length) return '';
		return t.form.outstanding(mine.length, money(mine.reduce((s, r) => s + (r.status === 'O' ? Number(r.balance) || 0 : Number(r.amount) || 0), 0)));
	};
	const dialogBody = () => {
		const lineErrors = errors.lines || {};
		const commonAmount = toNumber(form.amount);
		const sum = lines.reduce((s, l) => s + (amountOf(l, form) > 0 ? amountOf(l, form) : 0), 0);
		const accounts = list(view.cashAccounts).map((a) => ({value: a.id, label: `${a.number || ''} ${a.name || ''}`.trim()}));
		const addedIds = lines.map((l) => l.id);
		const firstNew = found.items.find((e) => addedIds.indexOf(String(e.id)) < 0);
		return (
			<Dialog
				title={t.form.title}
				width={860}
				onClose={() => setDialog(false)}
				actions={[
					<span class="s4vp-adv-sum">{lines.length ? t.form.sum(lines.length, sum > 0 ? money(sum) : '0') : ''}</span>,
					<Button label={t.form.cancel} onClick={() => setDialog(false)} />,
					<Button label={t.form.create(lines.length)} kind="primary" disabled={!lines.length || !!app.busy} title={lines.length ? '' : t.form.errNoLines} onClick={createAll} />,
				]}
			>
				<div class="s4vp-adv-top">
					<Field label={t.form.date} required={true} hint={errors.date ? <span class="s4vp-adv-err">{errors.date}</span> : null}>
						<DateInput value={form.date} onInput={setField('date')} />
					</Field>
					<Field label={t.form.cashAccount} hint={t.form.cashHint}>
						<AutoSelect value={form.cashAccount} onInput={setField('cashAccount')} options={accounts} placeholder={t.form.cashLater} />
					</Field>
					<Field label={t.form.amount} hint={t.form.amountHint}>
						<MoneyInput value={form.amount} onInput={setField('amount')} decimals={0} />
					</Field>
					<Field label={t.form.memo} hint={t.form.memoHint}>
						<TextInput value={form.memo} onInput={setField('memo')} />
					</Field>
				</div>
				<div class="s4vp-adv-find">
					<Field label={t.form.find}>
						<TextInput type="search" value={query} onInput={search} placeholder={t.form.findPlaceholder} onEnter={() => firstNew && addLine(firstNew)} />
					</Field>
					{query.trim() ? (
						<div class="s4vp-adv-results" role="group" aria-label={t.form.results}>
							{found.items.map((e) => {
								const added = addedIds.indexOf(String(e.id)) >= 0;
								const a = {type: 'button', class: 's4vp-adv-result'};
								if (added) a.disabled = 'disabled';
								else a.onClick = () => addLine(e);
								return (
									<button key={`e${e.id}`} {...a}>
										<span class="s4vp-adv-result-n">{`${e.code || ''} ${e.name || ''}`.trim()}</span>
										<span class="s4vp-small">{[e.department, added ? t.form.added : ''].filter(Boolean).join(' · ')}</span>
									</button>
								);
							})}
							{found.state === 'searching' && !found.items.length ? <div class="s4vp-adv-hint">{t.form.searching}</div> : null}
							{found.state === 'none' ? <div class="s4vp-adv-hint">{t.form.noResult}</div> : null}
							{found.state === 'error' ? <div class="s4vp-adv-hint s4vp-adv-err">{found.error || t.form.noResult}</div> : null}
							{found.more ? <div class="s4vp-adv-hint">{t.form.more}</div> : null}
						</div>
					) : null}
				</div>
				<div class="s4vp-adv-lines">
					<table class="s4vp-tbl" aria-label={t.form.lines}>
						<thead>
							<tr>
								<th>{t.form.employee}</th>
								<th class="s4vp-r" style={{width: '170px'}}>{t.form.lineAmount}</th>
								<th style={{width: '250px'}}>{t.form.lineMemo}</th>
								<th style={{width: '64px'}}>{''}</th>
							</tr>
						</thead>
						<tbody>
							{lines.map((l) => {
								const label = `${l.code} ${l.name}`.trim();
								const warn = outstanding(l.id);
								return (
									<tr key={`l${l.id}`} class={lineErrors[l.id] ? 's4vp-adv-bad' : 's4vp-adv-ok'}>
										<td>
											<span class="s4vp-adv-emp">
												<span class="s4vp-adv-emp-n">{label}</span>
												<span class="s4vp-small">{[l.department, warn].filter(Boolean).join(' · ')}</span>
												{lineErrors[l.id] ? <span class="s4vp-adv-err">{lineErrors[l.id]}</span> : null}
											</span>
										</td>
										<td class="s4vp-r">
											<MoneyInput value={l.amount} onInput={setLine(l.id, 'amount')} decimals={0} placeholder={commonAmount > 0 ? money(commonAmount) : ''} ariaLabel={t.form.amountOf(label)} />
										</td>
										<td>
											<TextInput value={l.memo} onInput={setLine(l.id, 'memo')} placeholder={form.memo || ''} ariaLabel={t.form.memoOf(label)} />
										</td>
										<td>
											<Button small={true} kind="ghost" label={t.form.remove} ariaLabel={t.form.removeOf(label)} onClick={() => removeLine(l.id)} />
										</td>
									</tr>
								);
							})}
							{lines.length ? null : (
								<tr key="none">
									<td colSpan="4">
										<div class="s4vp-empty">{t.form.noLines}</div>
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
				{errors.general ? <div class="s4vp-adv-reason s4vp-adv-err" role="alert">{errors.general}</div> : null}
			</Dialog>
		);
	};

	return (
		<Page>
			<PageHeader
				title={t.title}
				sub={subsidiary ? t.sub : t.noSubsidiary}
				actions={[
					<Button label={t.legacy} kind="ghost" onClick={() => app.go('advances')} />,
					<Button label={t.refresh} onClick={() => load()} />,
					<Button label={t.newAdvance} kind="primary" disabled={!subsidiary || !canEdit || !!app.busy} title={canEdit ? '' : t.form.noRole} onClick={openDialog} />,
				]}
			/>
			<StatCards cards={statCards} />
			<div class="s4vp-cols">
				<div class="s4vp-col-main">
					<Card flush={true} label={t.title}>
						<Table
							label={t.title}
							columns={columns}
							rows={rows}
							keyOf={(r) => r.id}
							onRowClick={(r) => setSelected(String(r.id) === String(selected) ? '' : String(r.id))}
							selectedKey={current ? current.id : ''}
							total={total}
							empty={filter ? t.emptyFilter : t.empty}
							search={true}
							searchPlaceholder={t.search}
							maxHeight="max(260px, calc(100vh - 384px))"
							toolbar={<Chips items={chipItems} value={filter} onPick={setFilter} label={t.chips.label} />}
						/>
					</Card>
				</div>
				{current ? <div class="s4vp-col-side s4vp-adv-side">{detailPanel(current)}</div> : null}
			</div>
			{dialog ? dialogBody() : null}
		</Page>
	);
}
