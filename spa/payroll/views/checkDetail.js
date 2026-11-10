/**
 * Kiểm tra bảng lương và nhật ký (mẫu docs/design/CanhBao.dc.html). Tham số route: id (bảng lương), rule, employee, tab ('log').
 *
 * Tab Cảnh báo: danh sách bên trái (ô tìm, lọc theo mức độ và trạng thái), chi tiết bên phải (giải thích, số liệu nền, so sánh
 * từng khoản với kỳ trước, khoản nhập tay trong kỳ) và khung Xử lý (gợi ý, người phụ trách, ghi chú, Chấp nhận / Đã xử lý /
 * Mở lại, lịch sử). Tab Nhật ký: lưới thao tác trên bảng lương có ô tìm và nút tải xuống.
 *
 * Cảnh báo đang chọn nằm trên route (rule, employee) nên dán lại đường dẫn là mở đúng trường hợp; chưa chọn thì lấy mục đầu.
 * Dữ liệu: GET checksList, checkDetail, auditLog; POST resolveCheck (api/Checks.js, api/AuditLog.js).
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post, openRecord, download} from '../lib/api.js';
import {money, num, pct, fmtDate, quickFilter} from '../lib/format.js';
import {pick} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Table, Badge, Chips, Tabs, Select, Field, TextArea, SearchBox, SidePanel, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		title: 'Kiểm tra bảng lương',
		crumbRun: 'Chạy lương',
		crumbChecks: 'Kiểm tra',
		noBatch: 'Chưa chọn bảng lương. Mở một bảng lương ở tab Chạy lương rồi bấm vào cảnh báo cần xem.',
		toList: 'Về danh sách bảng lương',
		back: 'Về bảng lương',
		refresh: 'Tải lại',
		prev: 'Trường hợp trước',
		next: 'Trường hợp sau',
		loading: 'Đang tải cảnh báo...',
		loadingDetail: 'Đang tải chi tiết...',
		loadingLog: 'Đang tải nhật ký...',
		saving: 'Đang lưu...',
		tabChecks: 'Cảnh báo',
		tabLog: 'Nhật ký',
		sub: (b) => `Kỳ ${b.periodName || ''}${b.periodStart ? ` (${fmtDate(b.periodStart)} - ${fmtDate(b.periodEnd)})` : ''}${b.prevBatch ? ` so với kỳ ${b.prevBatch.periodName} (${b.prevBatch.name})` : ' - chưa có bảng lương kỳ trước để so sánh'}`,
		summary: (c) => `${c.errors} lỗi chặn duyệt, ${c.warnings} cảnh báo chưa xử lý, ${c.resolved} đã đóng`,
		batchStatus: {H: 'Tạm giữ', B: 'Chờ tính', C: 'Đã tính', P: 'Chờ duyệt', A: 'Đã duyệt', J: 'Từ chối', R: 'Đã ghi sổ', V: 'Đã đảo'},
		listTitle: 'Danh sách cảnh báo',
		search: 'Tìm tên, mã nhân viên, cảnh báo',
		shown: (n, total) => `${n} / ${total} mục`,
		allSeverity: 'Tất cả',
		severity: {error: 'Lỗi', warn: 'Cảnh báo', info: 'Thông tin'},
		severityFilter: 'Lọc theo mức độ',
		statusFilter: 'Lọc theo trạng thái',
		allStatus: 'Mọi trạng thái',
		status: {open: 'Chưa xử lý', accepted: 'Đã chấp nhận', resolved: 'Đã xử lý'},
		blocksApproval: 'Chặn duyệt',
		batchLevel: 'Cả bảng lương',
		colCheck: 'Cảnh báo',
		colState: 'Mức độ, trạng thái',
		none: 'Không có cảnh báo nào. Bảng lương sẵn sàng cho bước duyệt.',
		listNone: 'Không có cảnh báo.',
		noneFiltered: 'Không có cảnh báo nào khớp bộ lọc.',
		pickOne: 'Chọn một cảnh báo ở danh sách bên trái để xem chi tiết.',
		gone: 'Cảnh báo này không còn: dữ liệu đã được sửa hoặc bảng lương đã tính lại.',
		reopened: 'Cảnh báo đã từng được đóng nhưng số liệu thay đổi sau đó nên được mở lại.',
		why: 'Vì sao có cảnh báo',
		facts: {
			employees: 'Số nhân viên trong bảng', salaryType: 'Loại lương', hireDate: 'Ngày vào làm', terminationDate: 'Ngày làm việc cuối', stdDays: 'Công chuẩn', workDays: 'Công hưởng lương',
			hours: 'Giờ tính lương', insuranceWage: 'Lương đóng bảo hiểm', minWage: 'Mức tối thiểu trong thiết lập', region: 'Vùng lương', threshold: 'Ngưỡng cảnh báo',
		},
		salaryType: {M: 'Lương tháng', D: 'Lương ngày', H: 'Lương giờ'},
		compareTitle: 'So sánh từng khoản với kỳ trước',
		compareSub: (c) => (c.hasPrev ? `Kỳ ${c.periodName} so với kỳ ${c.prevPeriodName}` : 'Nhân viên không có dòng ở bảng lương kỳ trước'),
		compareSearch: 'Tìm khoản, số tiền',
		colItem: 'Khoản',
		colPrev: (c) => (c.prevPeriodName ? `Kỳ ${c.prevPeriodName}` : 'Kỳ trước'),
		colCur: (c) => (c.periodName ? `Kỳ ${c.periodName}` : 'Kỳ này'),
		colDiff: 'Chênh lệch',
		rows: {gross: 'Tổng thu nhập', ee_ins: 'Bảo hiểm người lao động', pit: 'Thuế TNCN', other_ded: 'Khấu trừ khác', advance: 'Cấn trừ tạm ứng', net: 'Thực lĩnh'},
		inputsTitle: 'Khoản nhập tay trong kỳ',
		inputsNone: 'Không có khoản nhập tay nào cho nhân viên này trong kỳ.',
		inputKind: {E: 'Thu nhập', D: 'Khấu trừ'},
		handle: 'Xử lý',
		hint: 'Gợi ý xử lý',
		openProfile: 'Mở hồ sơ lương của nhân viên',
		openAttendance: 'Xem công trong kỳ',
		openRun: 'Mở bảng lương để sửa và tính lại',
		assignee: 'Người phụ trách',
		unassigned: 'Chưa giao',
		note: 'Ghi chú (bắt buộc khi đóng cảnh báo)',
		noteHint: 'Ví dụ: Đã hỏi Nhân sự, thưởng theo quyết định ngày 27/03, hợp lệ.',
		noteRequired: 'Hãy ghi chú lý do trước khi đóng cảnh báo.',
		accept: 'Chấp nhận',
		acceptTitle: 'Hợp lệ, đóng cảnh báo và giữ nguyên số liệu',
		resolve: 'Đã xử lý',
		resolveTitle: 'Đã xử lý xong, đóng cảnh báo',
		reopen: 'Mở lại',
		saveNote: 'Lưu ghi chú',
		errorNoClose: 'Lỗi chặn duyệt không đóng tay được: sửa dữ liệu rồi tính lại, cảnh báo sẽ tự mất.',
		footnote: 'Sửa dữ liệu rồi tính lại thì cảnh báo tự đóng nếu không còn vi phạm. Mọi lần đóng đều ghi vào nhật ký.',
		saved: 'Đã lưu kết quả xử lý.',
		history: 'Lịch sử xử lý',
		historyNone: 'Chưa có lần xử lý nào.',
		assignedTo: (n) => `giao cho ${n}`,
		logTitle: (name) => `Nhật ký bảng lương ${name || ''}`,
		logSearch: 'Tìm người, thao tác, chi tiết',
		logEmpty: 'Chưa có thao tác nào được ghi cho bảng lương này.',
		logUnavailable: 'Nhật ký chưa sẵn sàng trên tài khoản này (bản ghi nhật ký chưa được cài).',
		downloadLog: 'Tải xuống',
		logCols: {at: 'Thời điểm', user: 'Người thực hiện', label: 'Thao tác', detail: 'Chi tiết'},
	},
	en: {
		title: 'Payroll checks',
		crumbRun: 'Run payroll',
		crumbChecks: 'Checks',
		noBatch: 'No payroll batch selected. Open a batch on the Run payroll tab and click the check you want to review.',
		toList: 'Back to payroll batches',
		back: 'Back to the batch',
		refresh: 'Refresh',
		prev: 'Previous case',
		next: 'Next case',
		loading: 'Loading checks...',
		loadingDetail: 'Loading details...',
		loadingLog: 'Loading the activity log...',
		saving: 'Saving...',
		tabChecks: 'Checks',
		tabLog: 'Activity log',
		sub: (b) => `Period ${b.periodName || ''}${b.periodStart ? ` (${fmtDate(b.periodStart)} - ${fmtDate(b.periodEnd)})` : ''}${b.prevBatch ? ` compared with period ${b.prevBatch.periodName} (${b.prevBatch.name})` : ' - no previous batch to compare with'}`,
		summary: (c) => `${c.errors} blocking error(s), ${c.warnings} open warning(s), ${c.resolved} closed`,
		batchStatus: {H: 'On hold', B: 'Pending calculation', C: 'Calculated', P: 'Pending approval', A: 'Approved', J: 'Rejected', R: 'Released', V: 'Reversed'},
		listTitle: 'Checks',
		search: 'Search name, employee code, check',
		shown: (n, total) => `${n} / ${total} items`,
		allSeverity: 'All',
		severity: {error: 'Error', warn: 'Warning', info: 'Info'},
		severityFilter: 'Filter by severity',
		statusFilter: 'Filter by status',
		allStatus: 'Any status',
		status: {open: 'Open', accepted: 'Accepted', resolved: 'Resolved'},
		blocksApproval: 'Blocks approval',
		batchLevel: 'Whole batch',
		colCheck: 'Check',
		colState: 'Severity, status',
		none: 'No checks found. The batch is ready for approval.',
		listNone: 'No checks.',
		noneFiltered: 'No checks match the filters.',
		pickOne: 'Select a check in the list on the left to see its details.',
		gone: 'This check no longer exists: the data was fixed or the batch was recalculated.',
		reopened: 'This check was closed before, but the figures changed afterwards, so it is open again.',
		why: 'Why this check was raised',
		facts: {
			employees: 'Employees on the batch', salaryType: 'Salary type', hireDate: 'Hire date', terminationDate: 'Last working day', stdDays: 'Standard days', workDays: 'Paid work days',
			hours: 'Payroll hours', insuranceWage: 'Insurance wage', minWage: 'Minimum in setup', region: 'Wage region', threshold: 'Check threshold',
		},
		salaryType: {M: 'Monthly', D: 'Daily', H: 'Hourly'},
		compareTitle: 'Line by line comparison with the previous period',
		compareSub: (c) => (c.hasPrev ? `Period ${c.periodName} compared with period ${c.prevPeriodName}` : 'The employee has no line on the previous batch'),
		compareSearch: 'Search item, amount',
		colItem: 'Item',
		colPrev: (c) => (c.prevPeriodName ? `Period ${c.prevPeriodName}` : 'Previous period'),
		colCur: (c) => (c.periodName ? `Period ${c.periodName}` : 'This period'),
		colDiff: 'Difference',
		rows: {gross: 'Gross', ee_ins: 'Employee insurance', pit: 'PIT', other_ded: 'Other deductions', advance: 'Advance offset', net: 'Net pay'},
		inputsTitle: 'Manual lines in the period',
		inputsNone: 'No manual lines for this employee in the period.',
		inputKind: {E: 'Earning', D: 'Deduction'},
		handle: 'Handling',
		hint: 'Suggested action',
		openProfile: 'Open the payroll profile',
		openAttendance: 'View attendance of the period',
		openRun: 'Open the batch to fix and recalculate',
		assignee: 'Assignee',
		unassigned: 'Unassigned',
		note: 'Note (required to close a check)',
		noteHint: 'For example: Confirmed with HR, bonus per the decision dated 27/03, valid.',
		noteRequired: 'Enter a note with the reason before closing the check.',
		accept: 'Accept',
		acceptTitle: 'Valid: close the check and keep the figures',
		resolve: 'Resolved',
		resolveTitle: 'Handled: close the check',
		reopen: 'Reopen',
		saveNote: 'Save note',
		errorNoClose: 'Blocking errors cannot be closed by hand: fix the data and recalculate, the check then disappears.',
		footnote: 'When the data is fixed and the batch recalculated, the check closes by itself. Every closing is written to the activity log.',
		saved: 'Handling result saved.',
		history: 'Handling history',
		historyNone: 'No handling recorded yet.',
		assignedTo: (n) => `assigned to ${n}`,
		logTitle: (name) => `Activity log of batch ${name || ''}`,
		logSearch: 'Search user, action, details',
		logEmpty: 'No activity has been recorded for this batch yet.',
		logUnavailable: 'The activity log is not available on this account yet (the log record is not installed).',
		downloadLog: 'Download',
		logCols: {at: 'Time', user: 'User', label: 'Action', detail: 'Details'},
	},
};

const SEVERITY_TONE = {error: 'error', warn: 'warn', info: 'info'};
const STATUS_TONE = {open: 'warn', accepted: 'ok', resolved: 'ok'};
const BATCH_TONE = {H: 'muted', B: 'info', C: 'warn', P: 'warn', A: 'ok', J: 'error', R: 'ok', V: 'muted'};
const EMPTY_COUNTS = {open: 0, errors: 0, warnings: 0, resolved: 0};

const pad = (n) => String(n).padStart(2, '0');
// Thời điểm lưu dạng ISO UTC; hiện theo giờ máy người dùng dd/mm/yyyy HH:mm
const fmtAt = (iso) => {
	try {
		const d = new Date(iso);
		if (!iso || isNaN(d.getTime())) return String(iso || '');
		return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	} catch (e) {
		return String(iso || '');
	}
};
const signed = (n) => {
	const v = Math.round(Number(n) || 0);
	if (n === null || n === undefined || v === 0) return '-';
	return `${v > 0 ? '+' : '-'}${Math.abs(v).toLocaleString('vi-VN')}`;
};
const pctSigned = (r) => (r === null || r === undefined ? '' : `${(Math.abs(Number(r)) * 100).toLocaleString('vi-VN', {maximumFractionDigits: 1})}%`);
const csvCell = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
const who = (it) => [it.employeeCode, it.employeeName].filter(Boolean).join(' ');

export default function CheckDetailView({app}) {
	const t = pick(TEXT);
	const boot = app.boot || {};
	const params = (app.route && app.route.params) || {};
	const id = params.id ? String(params.id) : '';
	const tab = params.tab === 'log' ? 'log' : 'checks';
	const paramKey = params.rule ? (params.employee ? `${params.rule}:${params.employee}` : String(params.rule)) : '';

	const [list, setList] = useState(null);
	const [detail, setDetail] = useState(null);
	const [log, setLog] = useState(null);
	const [severity, setSeverity] = useState('');
	const [status, setStatus] = useState('');
	const [query, setQuery] = useState('');
	// Giá trị form giữ trong ref rồi setState: hai ô cập nhật liền nhau không ghi đè nhau
	const formRef = useRef({note: '', assignee: ''});
	const [form, setForm] = useState(formRef.current);
	const [needNote, setNeedNote] = useState(false);
	const alive = useRef(true);
	const listReq = useRef(0);
	const detailReq = useRef(0);
	const logReq = useRef(0);

	const items = list && Array.isArray(list.items) ? list.items : [];
	const selKey = paramKey || (items.length ? items[0].key : '');
	const selected = items.find((it) => it.key === selKey) || null;

	const setFormValues = (v) => {
		formRef.current = v;
		setForm(v);
	};
	const setField = (k) => (v) => setFormValues(Object.assign({}, formRef.current, {[k]: v}));

	const loadList = () => {
		if (!id) return Promise.resolve();
		listReq.current += 1;
		const mine = listReq.current;
		return app.run(t.loading, call({action: 'checksList', batch: id})).then((r) => {
			if (!alive.current || mine !== listReq.current || !r) return;
			setList(r);
		});
	};
	const loadDetail = (key) => {
		detailReq.current += 1;
		const mine = detailReq.current;
		if (!id || !key) {
			setDetail(null);
			return Promise.resolve();
		}
		const i = key.indexOf(':');
		const rule = i < 0 ? key : key.slice(0, i);
		const employee = i < 0 ? '' : key.slice(i + 1);
		return app.run(t.loadingDetail, call({action: 'checkDetail', batch: id, rule, employee})).then((r) => {
			if (!alive.current || mine !== detailReq.current || !r) return;
			setDetail(Object.assign({key}, r));
			setNeedNote(false);
			setFormValues({note: (r.item && r.item.note) || '', assignee: (r.item && r.item.assignee) || ''});
		});
	};
	const loadLog = () => {
		if (!id) return Promise.resolve();
		logReq.current += 1;
		const mine = logReq.current;
		return app.run(t.loadingLog, call({action: 'auditLog', batch: id})).then((r) => {
			if (!alive.current || mine !== logReq.current || !r) return;
			setLog(r);
		});
	};

	useEffect(() => {
		alive.current = true;
		setList(null);
		setDetail(null);
		setLog(null);
		loadList();
		return () => {
			alive.current = false;
		};
	}, [id]);
	useEffect(() => {
		if (tab === 'checks') loadDetail(selKey);
	}, [id, selKey, tab]);
	useEffect(() => {
		if (tab === 'log') loadLog();
	}, [id, tab]);

	const go = (extra) => app.go('checkDetail', Object.assign({id, rule: params.rule || '', employee: params.employee || '', tab: tab === 'log' ? 'log' : ''}, extra));
	const pickItem = (it) => go({rule: it.rule, employee: it.employee || '', tab: ''});
	const refresh = () => {
		loadList();
		if (tab === 'log') loadLog();
		else loadDetail(selKey);
	};

	const save = (nextStatus) => {
		const it = detail && detail.item;
		if (!it) return;
		const v = formRef.current;
		if (nextStatus && nextStatus !== 'open' && !String(v.note || '').trim()) {
			setNeedNote(true);
			return;
		}
		setNeedNote(false);
		const body = {action: 'resolveCheck', batch: id, rule: it.rule, employee: it.employee || '', note: v.note || '', assignee: v.assignee || ''};
		if (nextStatus) body.status = nextStatus;
		app.run(t.saving, post(body)).then((r) => {
			if (!r || !alive.current) return;
			app.notify(t.saved, 'ok');
			loadList();
			loadDetail(it.key);
		});
	};

	// ------------------------------------------------------------------ không có bảng lương

	if (!id) {
		return (
			<Page>
				<PageHeader title={t.title} />
				<Card>
					<Empty text={t.noBatch} />
					<div style={{display: 'flex', justifyContent: 'center'}}>
						<Button kind="primary" label={t.toList} onClick={() => app.go('payrollList')} />
					</div>
				</Card>
			</Page>
		);
	}

	// ------------------------------------------------------------------ danh sách bên trái

	const batch = (list && list.batch) || {id};
	const counts = (list && list.counts) || EMPTY_COUNTS;
	const bySeverity = {error: 0, warn: 0, info: 0};
	items.forEach((it) => (bySeverity[it.severity] = (bySeverity[it.severity] || 0) + 1));
	// Chữ hiển thị đưa vào dữ liệu dòng để ô tìm khớp được "Lỗi", "Chưa xử lý"...
	const rows = items.map((it) => Object.assign({}, it, {severityText: t.severity[it.severity] || '', statusText: t.status[it.status] || ''}));
	const filtered = rows.filter((it) => (!severity || it.severity === severity) && (!status || it.status === status));
	let shown = filtered;
	try {
		shown = quickFilter(filtered, query).rows;
	} catch (e) {
		shown = filtered;
	}
	const at = shown.findIndex((it) => it.key === selKey);
	const prevItem = at > 0 ? shown[at - 1] : null;
	const nextItem = at >= 0 && at < shown.length - 1 ? shown[at + 1] : at < 0 && shown.length ? shown[0] : null;

	const listColumns = [
		{
			key: 'title',
			label: t.colCheck,
			render: (it) => (
				<span style={{display: 'block', minWidth: '0'}}>
					<span style={{display: 'block', fontWeight: '600'}}>{it.employee ? who(it) || it.employee : t.batchLevel}</span>
					<span class="s4vp-small" style={{display: 'block'}}>
						{it.title}
					</span>
				</span>
			),
		},
		{
			key: 'status',
			label: t.colState,
			width: 124,
			render: (it) => (
				<span style={{display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start'}}>
					<Badge text={t.severity[it.severity] || it.severity} tone={SEVERITY_TONE[it.severity] || 'muted'} />
					{it.severity === 'error' ? null : <Badge text={t.status[it.status] || it.status} tone={STATUS_TONE[it.status] || 'muted'} />}
				</span>
			),
		},
	];

	const listCard = (
		<Card flush={true} label={t.listTitle}>
			<div style={{padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '10px'}}>
				<div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center'}}>
					<div style={{flex: '1 1 170px', minWidth: '0'}}>
						<SearchBox value={query} onInput={setQuery} placeholder={t.search} width="100%" />
					</div>
					<div style={{flex: '0 1 160px', minWidth: '0'}}>
						<Select
							value={status}
							onInput={setStatus}
							ariaLabel={t.statusFilter}
							placeholder={t.allStatus}
							options={['open', 'accepted', 'resolved'].map((s) => ({value: s, label: t.status[s]}))}
						/>
					</div>
				</div>
				<div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'space-between'}}>
					<Chips
						label={t.severityFilter}
						value={severity}
						onPick={setSeverity}
						items={[
							{value: '', label: t.allSeverity, count: items.length},
							{value: 'error', label: t.severity.error, count: bySeverity.error, tone: 'error'},
							{value: 'warn', label: t.severity.warn, count: bySeverity.warn, tone: 'warn'},
							{value: 'info', label: t.severity.info, count: bySeverity.info},
						]}
					/>
					{shown.length !== items.length ? <span class="s4vp-small">{t.shown(shown.length, items.length)}</span> : null}
				</div>
			</div>
			<Table
				label={t.listTitle}
				columns={listColumns}
				rows={shown}
				keyOf={(it) => it.key}
				selectedKey={selKey}
				onRowClick={pickItem}
				maxHeight={400}
				empty={!list ? t.loading : items.length ? t.noneFiltered : t.listNone}
			/>
		</Card>
	);

	// ------------------------------------------------------------------ chi tiết bên phải

	const current = detail && detail.key === selKey ? detail : null;
	const item = current ? current.item : null;
	const head = item || selected;

	const factValue = (f) => {
		if (f.kind === 'money') return money(f.value);
		if (f.kind === 'num') return num(f.value);
		if (f.kind === 'pct') return pct(f.value);
		if (f.kind === 'date') return fmtDate(f.value);
		if (f.kind === 'salaryType') return t.salaryType[f.value] || String(f.value);
		return String(f.value);
	};

	const compare = current ? current.compare : null;
	const compareRows = compare
		? (compare.rows || []).map((r) => Object.assign({}, r, {label: t.rows[r.key] || r.label || r.key}))
		: [];
	const compareColumns = compare
		? [
				{key: 'label', label: t.colItem, render: (r) => <span style={{fontWeight: r.strong ? '700' : r.changed ? '600' : '400'}}>{r.label}</span>},
				{key: 'prev', label: t.colPrev(compare), align: 'right', nowrap: true, render: (r) => <span style={{fontWeight: r.strong ? '700' : '400'}}>{r.prev === null ? '' : money(r.prev)}</span>},
				{key: 'cur', label: t.colCur(compare), align: 'right', nowrap: true, render: (r) => <span style={{fontWeight: r.strong ? '700' : '400'}}>{r.cur === null ? '' : money(r.cur)}</span>},
				{
					key: 'diff',
					label: t.colDiff,
					align: 'right',
					nowrap: true,
					render: (r) =>
						r.diff === null ? (
							''
						) : (
							<span style={{fontWeight: r.changed ? '700' : '400', color: r.changed ? '#6B3A00' : '#55616B'}}>
								{r.key === 'net' && r.changed && r.ratio !== null ? `${signed(r.diff)} (${pctSigned(r.ratio)})` : signed(r.diff)}
							</span>
						),
				},
			]
		: [];

	const inputs = current && Array.isArray(current.inputs) ? current.inputs : [];
	const history = current && Array.isArray(current.history) ? current.history : [];
	const facts = current && Array.isArray(current.facts) ? current.facts : [];
	const assigneeOptions = ((list && list.assignees) || []).map((a) => ({value: String(a.id), label: a.name || String(a.id)}));
	if (form.assignee && !assigneeOptions.some((o) => o.value === String(form.assignee))) assigneeOptions.push({value: String(form.assignee), label: (item && item.assigneeName) || String(form.assignee)});
	const busy = !!app.busy;

	const handleButtons = [];
	if (item) {
		if (item.canClose && item.status === 'open') {
			handleButtons.push(<Button kind="primary" label={t.accept} title={t.acceptTitle} disabled={busy} onClick={() => save('accepted')} />);
			handleButtons.push(<Button label={t.resolve} title={t.resolveTitle} disabled={busy} onClick={() => save('resolved')} />);
		} else if (item.canClose) {
			handleButtons.push(<Button kind="primary" label={t.reopen} disabled={busy} onClick={() => save('open')} />);
		}
		handleButtons.push(<Button label={t.saveNote} disabled={busy} onClick={() => save('')} />);
	}

	const profileType = boot.recordTypes && boot.recordTypes.employee;
	const links = [];
	if (current && current.profileId && profileType) links.push(<Button kind="link" label={t.openProfile} onClick={() => openRecord(profileType, current.profileId)} />);
	if (batch.period) links.push(<Button kind="link" label={t.openAttendance} onClick={() => app.go('attendance', {period: batch.period})} />);
	links.push(<Button kind="link" label={t.openRun} onClick={() => app.go('payrollRun', {id})} />);

	let detailArea;
	if (!selKey) {
		detailArea = (
			<Card>
				<Empty text={!list ? t.loading : items.length ? t.pickOne : t.none} />
			</Card>
		);
	} else if (current && !item) {
		detailArea = (
			<Card tone="ok">
				<Empty text={t.gone} />
				{history.length ? (
					<div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
						<div style={{fontWeight: '700'}}>{t.history}</div>
						{history.map((h, i) => (
							<div key={`h${i}`} class="s4vp-small">{`${fmtAt(h.at)} - ${h.user || ''} - ${t.status[h.status] || h.status || ''}${h.note ? `: ${h.note}` : ''}`}</div>
						))}
					</div>
				) : null}
			</Card>
		);
	} else if (!head) {
		detailArea = (
			<Card>
				<Empty text={!list || !current ? t.loadingDetail : t.gone} />
			</Card>
		);
	} else {
		const heading = head.employee ? `${who(head) || head.employee}${head.headline ? ` - ${head.headline}` : ''}` : head.title;
		detailArea = (
			<div style={{display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '0'}}>
				<Card tone={head.severity === 'error' ? 'error' : head.status === 'open' && head.severity === 'warn' ? 'warn' : ''} label={t.why}>
					<div style={{display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'flex-start', justifyContent: 'space-between'}}>
						<div style={{display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '0', flex: '1 1 320px'}}>
							<h2 style={{fontSize: '20px', fontWeight: '700', lineHeight: '1.25', overflowWrap: 'anywhere'}}>{heading}</h2>
							<div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center'}}>
								<Badge text={t.severity[head.severity] || head.severity} tone={SEVERITY_TONE[head.severity] || 'muted'} large={true} />
								{head.severity === 'error' ? <Badge text={t.blocksApproval} tone="error" large={true} /> : <Badge text={t.status[head.status] || head.status} tone={STATUS_TONE[head.status] || 'muted'} large={true} />}
								<span class="s4vp-muted" style={{fontSize: '13px'}}>
									{head.title}
								</span>
							</div>
						</div>
						<div class="s4vp-actions">
							<Button label={t.prev} small={true} disabled={!prevItem} onClick={() => prevItem && pickItem(prevItem)} />
							<Button label={t.next} small={true} disabled={!nextItem} onClick={() => nextItem && pickItem(nextItem)} />
						</div>
					</div>
					{item && item.description ? <div style={{overflowWrap: 'anywhere'}}>{item.description}</div> : null}
					{item && item.reopened && item.canClose ? <div class="s4vp-small">{t.reopened}</div> : null}
					{facts.length ? (
						<div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '6px 28px'}}>
							{facts.map((f) => (
								<div key={`f${f.key}`} class="s4vp-line">
									<span class="s4vp-muted">{t.facts[f.key] || f.key}</span>
									<span style={{fontVariantNumeric: 'tabular-nums', fontWeight: '600', textAlign: 'right'}}>{factValue(f)}</span>
								</div>
							))}
						</div>
					) : null}
				</Card>

				<div class="s4vp-cols">
					<div class="s4vp-col-main">
						{compare ? (
							<Card flush={true} title={t.compareTitle} sub={t.compareSub(compare)}>
								<Table label={t.compareTitle} columns={compareColumns} rows={compareRows} keyOf={(r) => r.key} search={true} searchPlaceholder={t.compareSearch} />
							</Card>
						) : null}
						{item && item.employee ? (
							<Card title={t.inputsTitle}>
								{inputs.length ? (
									inputs.map((x) => (
										<div key={`i${x.id}`} class="s4vp-line">
											<span style={{minWidth: '0', overflowWrap: 'anywhere'}}>{`${t.inputKind[x.kind] || x.kind || ''}${x.description ? ` - ${x.description}` : ''}`}</span>
											<span style={{fontVariantNumeric: 'tabular-nums', fontWeight: '600', whiteSpace: 'nowrap'}}>{money(x.amount)}</span>
										</div>
									))
								) : (
									<div class="s4vp-muted" style={{fontSize: '13px'}}>
										{t.inputsNone}
									</div>
								)}
							</Card>
						) : null}
					</div>

					<SidePanel title={t.handle}>
						{item && item.hint ? (
							<div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
								<div class="s4vp-small">{t.hint}</div>
								<div style={{overflowWrap: 'anywhere'}}>{item.hint}</div>
							</div>
						) : null}
						<div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
							{links.map((l, i) => (
								<span key={`l${i}`}>{l}</span>
							))}
						</div>
						{item ? (
							<Field label={t.assignee}>
								<Select value={form.assignee} onInput={setField('assignee')} options={assigneeOptions} placeholder={t.unassigned} ariaLabel={t.assignee} />
							</Field>
						) : null}
						{item ? (
							<Field label={t.note} hint={needNote ? null : t.noteHint}>
								<TextArea value={form.note} onInput={setField('note')} rows={3} ariaLabel={t.note} />
							</Field>
						) : null}
						{needNote ? (
							<div role="alert" style={{color: '#8A1C14', fontSize: '13px', fontWeight: '600'}}>
								{t.noteRequired}
							</div>
						) : null}
						{handleButtons.length ? (
							<div class="s4vp-actions">
								{handleButtons.map((b, i) => (
									<span key={`b${i}`} style={{display: 'contents'}}>
										{b}
									</span>
								))}
							</div>
						) : null}
						<div class="s4vp-small">{item && !item.canClose ? t.errorNoClose : t.footnote}</div>
						{item ? (
							<div style={{display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid #E1E5E8', paddingTop: '12px'}}>
								<div style={{fontWeight: '700'}}>{t.history}</div>
								{history.length ? (
									history.map((h, i) => (
										<div key={`h${i}`} style={{fontSize: '13px', overflowWrap: 'anywhere'}}>
											<span class="s4vp-muted">{`${fmtAt(h.at)} - ${h.user || ''}: `}</span>
											<span style={{fontWeight: '600'}}>{t.status[h.status] || h.status || ''}</span>
											{h.assigneeName ? <span>{`, ${t.assignedTo(h.assigneeName)}`}</span> : null}
											{h.note ? <span>{` - ${h.note}`}</span> : null}
										</div>
									))
								) : (
									<div class="s4vp-small">{t.historyNone}</div>
								)}
							</div>
						) : null}
					</SidePanel>
				</div>
			</div>
		);
	}

	// ------------------------------------------------------------------ nhật ký

	const logItems = log && Array.isArray(log.items) ? log.items : [];
	const logRows = logItems.map((r, i) => Object.assign({}, r, {id: `g${i}`, when: fmtAt(r.at)}));
	const logColumns = [
		{key: 'when', label: t.logCols.at, nowrap: true, width: 150},
		{key: 'user', label: t.logCols.user, nowrap: true},
		{key: 'label', label: t.logCols.label, nowrap: true, render: (r) => <span style={{fontWeight: '600'}}>{r.label || r.action}</span>},
		{key: 'detail', label: t.logCols.detail, render: (r) => <span style={{overflowWrap: 'anywhere'}}>{r.detail || ''}</span>},
	];
	const downloadLog = () => {
		const lines = [[t.logCols.at, t.logCols.user, t.logCols.label, t.logCols.detail].map(csvCell).join(',')].concat(logRows.map((r) => [r.when, r.user, r.label || r.action, r.detail].map(csvCell).join(',')));
		download(`nhat-ky-${batch.name || id}.csv`, `﻿${lines.join('\r\n')}`);
	};

	const logCard = (
		<Card flush={true} title={t.logTitle(batch.name)}>
			<Table
				label={t.logTitle(batch.name)}
				columns={logColumns}
				rows={logRows}
				keyOf={(r) => r.id}
				search={true}
				searchPlaceholder={t.logSearch}
				maxHeight={420}
				empty={!log ? t.loadingLog : log.unavailable ? t.logUnavailable : t.logEmpty}
				toolbar={<Button label={t.downloadLog} disabled={!logRows.length} onClick={downloadLog} />}
			/>
		</Card>
	);

	// ------------------------------------------------------------------ khung trang

	const crumbs = [{label: t.crumbRun, onClick: () => app.go('payrollList')}, {label: batch.name || `#${id}`, onClick: () => app.go('payrollRun', {id})}, {label: t.crumbChecks}];
	const headerStatus = batch.status ? {text: t.batchStatus[batch.status] || batch.status, tone: BATCH_TONE[batch.status] || 'muted'} : null;

	return (
		<Page>
			<PageHeader
				crumbs={crumbs}
				title={`${t.title} ${batch.name || ''}`.trim()}
				status={headerStatus}
				sub={list ? `${t.sub(batch)} - ${t.summary(counts)}` : t.loading}
				actions={[<Button label={t.refresh} disabled={busy} onClick={refresh} />, <Button label={t.back} kind="primary" onClick={() => app.go('payrollRun', {id})} />]}
			/>
			<Tabs
				value={tab}
				onPick={(v) => go({tab: v === 'log' ? 'log' : ''})}
				items={[
					{value: 'checks', label: t.tabChecks, count: list ? counts.open : null},
					{value: 'log', label: t.tabLog},
				]}
			/>
			{tab === 'log' ? (
				logCard
			) : (
				<div class="s4vp-cols">
					<div style={{flex: '3 1 300px', minWidth: '0'}}>{listCard}</div>
					<div style={{flex: '7 1 700px', minWidth: '0'}}>{detailArea}</div>
				</div>
			)}
		</Page>
	);
}
