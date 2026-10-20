/**
 * Màn hình chính "Lương VN" (S4 VN Payroll): bảng lương theo công ty con và kỳ (VP302000), hồ sơ lương (VP203000),
 * tạm ứng (VP301000), thiết lập ban đầu (Load VN Defaults, sinh kỳ). Dữ liệu và thao tác qua RESTlet
 * customscript_s4vp_rl_api; trạng thái và quyền kiểm tra phía máy chủ, nút chỉ ẩn / hiện cho gọn.
 * Thông báo hiện trên một dòng cạnh nút; lưới có ô lọc nhanh (không phân biệt dấu, mọi từ phải khớp, khớp số tiền).
 */
import {useState, useRef, useEffect, ArrayDataSource} from '@uif-js/core';
import {ApplicationHeader, StackPanel, GridPanel, Dropdown, TextBox, Button, DataGrid, Text, Heading} from '@uif-js/component';
import url from 'N/url';
import https from 'N/https';
import runtime from 'N/runtime';

const RESTLET = {scriptId: 'customscript_s4vp_rl_api', deploymentId: 'customdeploy_s4vp_rl_api'};
const PRINT = {scriptId: 'customscript_s4vp_sl_print', deploymentId: 'customdeploy_s4vp_sl_print'};

const TEXT = {
	vi: {
		title: 'Lương VN',
		subtitle: 'S4 VN Payroll',
		views: {batches: 'Bảng lương', profiles: 'Hồ sơ lương', advances: 'Tạm ứng lương', setup: 'Thiết lập'},
		view: 'Màn hình',
		subsidiary: 'Công ty con',
		period: 'Kỳ lương',
		allPeriods: '(Tất cả kỳ)',
		load: 'Xem',
		newBatch: 'Tạo bảng lương',
		description: 'Diễn giải',
		quick: 'Lọc nhanh (tên, mã, số tiền...)',
		quickCount: (n) => `${n} dòng khớp`,
		empty: 'Không có dữ liệu',
		loading: 'Đang tải...',
		working: 'Đang xử lý...',
		done: 'Xong',
		failed: 'Lỗi',
		back: 'Quay lại danh sách',
		openRecord: 'Mở bản ghi',
		status: {H: 'Tạm giữ', B: 'Chờ tính', C: 'Đã tính', P: 'Chờ duyệt', A: 'Đã duyệt', J: 'Từ chối', R: 'Đã ghi sổ', V: 'Đã đảo'},
		advStatus: {H: 'Tạm giữ', B: 'Chờ ghi sổ', O: 'Đang cấn trừ', C: 'Đã tất toán'},
		cols: {
			number: 'Số', period: 'Kỳ', status: 'Trạng thái', count: 'Số người', gross: 'Tổng thu nhập', eeIns: 'BH NLĐ', erIns: 'BH DN', pit: 'Thuế TNCN',
			otherDed: 'Khấu trừ khác', advance: 'Cấn trừ tạm ứng', net: 'Thực lĩnh', journal: 'Bút toán', code: 'Mã NV', name: 'Họ tên', dept: 'Bộ phận',
			std: 'Công chuẩn', work: 'Công TT', exempt: 'Miễn thuế', taxable: 'Chịu thuế', deps: 'NPT', family: 'Giảm trừ gia cảnh', assessable: 'Tính thuế',
			warn: 'Cảnh báo / lỗi', type: 'Loại', earning: 'Khoản', qty: 'Số lượng', rate: 'Đơn giá', mult: 'Hệ số', amount: 'Số tiền', exemptAmt: 'Miễn thuế',
			source: 'Nguồn', component: 'Khoản trích', base: 'Căn cứ', eeRate: 'Tỷ lệ NLĐ', erRate: 'Tỷ lệ DN', account: 'Tài khoản', debit: 'Nợ', credit: 'Có',
			memo: 'Diễn giải', dimension: 'Phòng ban / địa điểm', employment: 'Loại LĐ', salary: 'Lương HĐ', insWage: 'Lương đóng BH', effective: 'Hiệu lực',
			pitMethod: 'Thuế', profile: 'Hồ sơ', docDate: 'Ngày', balance: 'Số dư', offset: 'Đã cấn trừ', del: '',
		},
		actions: {
			loadEmployees: 'Nạp nhân viên', calculate: 'Tính lương', removeHold: 'Bỏ tạm giữ', hold: 'Tạm giữ', approve: 'Duyệt', reject: 'Từ chối', reopen: 'Mở lại',
			release: 'Ghi sổ', reverse: 'Đảo', agencyBills: 'Lập bill cơ quan thu', bankFile: 'File chi lương', payslips: 'In phiếu lương', paymentSheet: 'In bảng thanh toán',
			contractor: 'In quyết toán CTV', journal: 'Xem bút toán', refresh: 'Tải lại',
		},
		confirm: {release: 'Ghi sổ bảng lương này? Hệ thống tạo bút toán và cấn trừ tạm ứng.', reverse: 'Đảo bảng lương này? Hệ thống tạo bút toán đảo và hoàn số dư tạm ứng.', agencyBills: 'Lập bill nộp cơ quan BHXH, công đoàn, thuế?'},
		detailOf: (c, n) => `Chi tiết ${c} ${n}`,
		earnings: 'Thu nhập',
		insurance: 'Bảo hiểm, kinh phí công đoàn',
		inputs: 'Dòng nhập tay (thu nhập, khấu trừ sau thuế)',
		addInput: 'Thêm dòng',
		kind: {E: 'Thu nhập', D: 'Khấu trừ sau thuế'},
		employee: 'Nhân viên',
		earningType: 'Loại thu nhập',
		deductionCode: 'Mã khấu trừ',
		delete: 'Xóa',
		journalTitle: 'Bút toán dự kiến (chưa ghi sổ)',
		totals: (b) => `Tổng thu nhập ${money(b.gross)} · BH NLĐ ${money(b.ee_ins)} · BH DN ${money(b.er_ins)} · Thuế ${money(b.pit)} · Thực lĩnh ${money(b.net)}`,
		netWords: (w) => `Thực lĩnh nhân viên bằng chữ: ${w}`,
		unverified: (list) => `Tham số chưa đối chiếu văn bản gốc, cần kế toán trưởng duyệt: ${list}`,
		notReady: 'Chưa có thiết lập lương. Vào Thiết lập, bấm Nạp mặc định VN.',
		loadDefaults: 'Nạp mặc định VN',
		generate: 'Sinh kỳ lương',
		year: 'Năm',
		paygroup: 'Nhóm lương',
		setupLinks: 'Danh mục (mở màn hình NetSuite)',
		openSetup: 'Thiết lập chung',
		openCompany: 'Thiết lập theo công ty',
		openList: (n) => n,
		lists: {param: 'Tham số pháp lý', pit_bracket: 'Biểu thuế TNCN', ins_comp: 'Khoản trích theo lương', holiday: 'Ngày lễ', earning_type: 'Loại thu nhập', earning_rule: 'Quy tắc thu nhập', benefit_pkg: 'Gói phúc lợi', leave_type: 'Loại nghỉ', paygroup: 'Nhóm lương', period: 'Kỳ lương', attendance: 'Bảng tổng hợp công'},
		newProfile: 'Tạo hồ sơ lương',
		noProfile: 'Chưa có hồ sơ',
		created: (n) => `Đã tạo ${n}`,
		loaded: (r) => `Đã nạp ${r.added.length} người${r.skipped.length ? `, bỏ qua ${r.skipped.length} người đã ở bảng lương khác cùng kỳ: ${r.skipped.join(', ')}` : ''}`,
		calcDone: (r) => (r.queued ? 'Đã đưa vào hàng đợi tính lương (bảng lớn), bấm Tải lại sau ít phút' : r.ok ? 'Đã tính xong, không có lỗi' : `Có ${r.errors.length} nhân viên lỗi: ${r.errors.slice(0, 3).join('; ')}`),
		jeCreated: (id) => `Đã tạo bút toán ${id}`,
		billsCreated: (r) => `Đã lập ${r.created.length} bill${r.skipped.length ? `; khoản chưa có cơ quan thu: ${r.skipped.map((s) => s.code).join(', ')}` : ''}`,
		yes: 'Đồng ý',
		cancel: 'Hủy',
	},
	en: {},
};
// Bản tiếng Anh: nhãn gốc theo Acumatica
TEXT.en = Object.assign({}, TEXT.vi, {
	title: 'VN Payroll',
	views: {batches: 'Payroll Batches', profiles: 'Employee Payroll Profiles', advances: 'Payroll Advances', setup: 'Setup'},
	view: 'Screen', subsidiary: 'Subsidiary', period: 'Pay period', allPeriods: '(All periods)', load: 'View', newBatch: 'New batch', description: 'Description',
	quick: 'Quick filter (name, code, amount...)', quickCount: (n) => `${n} matching rows`, empty: 'No data', loading: 'Loading...', working: 'Working...', done: 'Done', failed: 'Error',
	back: 'Back to list', openRecord: 'Open record',
	status: {H: 'On Hold', B: 'Pending Calculation', C: 'Calculated', P: 'Pending Approval', A: 'Approved', J: 'Rejected', R: 'Released', V: 'Reversed'},
	advStatus: {H: 'On Hold', B: 'Pending Release', O: 'Open for Offset', C: 'Settled'},
	actions: {
		loadEmployees: 'Load Employees', calculate: 'Calculate', removeHold: 'Remove Hold', hold: 'Hold', approve: 'Approve', reject: 'Reject', reopen: 'Reopen', release: 'Release',
		reverse: 'Reverse', agencyBills: 'Create Agency Bills', bankFile: 'Export Bank File', payslips: 'Print Payslips', paymentSheet: 'Print Payment Sheet',
		contractor: 'Print Contractor Settlement', journal: 'Preview Journal', refresh: 'Refresh',
	},
	notReady: 'Payroll preferences are missing. Open Setup and click Load VN Defaults.', loadDefaults: 'Load VN Defaults', generate: 'Generate Periods', year: 'Year', paygroup: 'Pay group',
});

const fold = (v) =>
	String(v === null || v === undefined ? '' : v)
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[đĐ]/g, 'd')
		.toLowerCase();

function rowText(r) {
	const parts = [];
	for (const k of Object.keys(r)) {
		const v = r[k];
		if (v === null || v === undefined || typeof v === 'object' || typeof v === 'function') continue;
		parts.push(String(v));
		if (typeof v === 'number' && Math.abs(v) >= 1) parts.push(Math.round(Math.abs(v)).toLocaleString('vi-VN'));
	}
	return fold(parts.join(' '));
}

function quickFilter(rows, text) {
	const words = fold(text).split(/\s+/).filter((w) => w);
	if (!words.length) return {rows, count: null};
	const out = rows.filter((r) => {
		const t = rowText(r);
		return words.every((w) => t.indexOf(w) >= 0 || t.replace(/[.,]/g, '').indexOf(w.replace(/[.,]/g, '')) >= 0);
	});
	return {rows: out, count: out.length};
}

function language() {
	try {
		return String(runtime.getCurrentUser().getPreference({name: 'LANGUAGE'}) || '').toLowerCase().startsWith('vi') ? 'vi' : 'en';
	} catch (e) {
		return 'vi';
	}
}

const money = (n) => {
	if (n === null || n === undefined || n === '') return '';
	const v = Math.round(Number(n));
	if (v === 0) return '-';
	const s = Math.abs(v).toLocaleString('vi-VN');
	return v < 0 ? `(${s})` : s;
};
const num = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('vi-VN', {maximumFractionDigits: 2}));
const pct = (n) => (n === null || n === undefined || n === '' ? '' : `${(Number(n) * 100).toLocaleString('vi-VN', {maximumFractionDigits: 2})}%`);

const item = (child, key) => <StackPanel.Item key={key}>{child}</StackPanel.Item>;

function actionRow(buttons, messages) {
	const parts = [];
	buttons.forEach((b, i) => parts.push(item(b, `btn-${i}`)));
	const list = (messages || []).filter((m) => m && m.text);
	if (list.length) {
		parts.push(
			item(
				<Text size={Text.Size.S} type={list.some((m) => m.strong) ? Text.Type.STRONG : Text.Type.WEAK}>
					{list.map((m) => m.text).join('  ·  ')}
				</Text>,
				'status'
			)
		);
	}
	return (
		<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.M} alignment={StackPanel.Alignment.CENTER} wrap={true}>
			{parts}
		</StackPanel>
	);
}

const labeled = (label, control) => (
	<StackPanel orientation={StackPanel.Orientation.VERTICAL} itemGap={StackPanel.GapSize.XS}>
		<StackPanel.Item key="label">
			<Text size={Text.Size.S} type={Text.Type.WEAK}>
				{label}
			</Text>
		</StackPanel.Item>
		<StackPanel.Item key="control">{control}</StackPanel.Item>
	</StackPanel>
);

const cell = (child, key) => <GridPanel.Item key={key}>{child}</GridPanel.Item>;

const safe = (fn) => (args) => {
	try {
		return fn(args.cell.row.dataItem);
	} catch (e) {
		return <Text>{''}</Text>;
	}
};

const plain = (v, strong) => <Text weight={strong ? Text.Weight.BOLD : Text.Weight.NORMAL}>{v === null || v === undefined ? '' : String(v)}</Text>;
const textCol = (name, label, width, fn) => ({name, label, width, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => plain(fn(r), r.bold))});
const moneyCol = (name, label, width) => textCol(name, label, width || 125, (r) => money(r[name]));

function unwrap(response) {
	const body = typeof response.body === 'string' ? JSON.parse(response.body || '{}') : response.body;
	if (body && body.error) throw new Error(language() === 'vi' ? body.errorVi || body.error : body.error);
	return body;
}

function call(params) {
	return https.get.promise({url: url.resolveScript(Object.assign({}, RESTLET, {params})), headers: {'Content-Type': 'application/json'}}).then(unwrap);
}

function post(body) {
	return https.post.promise({url: url.resolveScript(Object.assign({}, RESTLET)), body: JSON.stringify(body), headers: {'Content-Type': 'application/json'}}).then(unwrap);
}

function openRecord(type, id) {
	if (!type || !id) return;
	window.open(url.resolveRecord({recordType: type, recordId: id}), '_blank');
}

function openJournal(id) {
	if (id) window.open(`/app/accounting/transactions/journal.nl?id=${encodeURIComponent(id)}`, '_blank');
}

function download(name, content) {
	const blob = new Blob([content], {type: 'text/csv;charset=utf-8'});
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	document.body.appendChild(a);
	a.click();
	setTimeout(() => {
		URL.revokeObjectURL(a.href);
		a.remove();
	}, 1000);
}

let renders = 0;
let windowStart = Date.now();

export default function PayrollApp() {
	if (Date.now() - windowStart > 2000) {
		windowStart = Date.now();
		renders = 0;
	}
	renders += 1;
	if (renders > 60) throw new Error('S4VP payroll: render loop detected');
	const t = useRef(TEXT[language()]).current;
	const [boot, setBoot] = useState(null);
	const [view, setView] = useState('batches');
	const [subsidiary, setSubsidiary] = useState('');
	const [period, setPeriod] = useState('');
	const [batches, setBatches] = useState([]);
	const [batch, setBatch] = useState(null);
	const [selected, setSelected] = useState(null);
	const [journal, setJournal] = useState(null);
	const [profiles, setProfiles] = useState([]);
	const [advances, setAdvances] = useState([]);
	const [quick, setQuick] = useState('');
	const [description, setDescription] = useState('');
	const [busy, setBusy] = useState('');
	const [notice, setNotice] = useState('');
	const [error, setError] = useState('');
	const [confirm, setConfirm] = useState(null);
	const [input, setInput] = useState({kind: 'E', employee: '', earning_type: '', code: '', qty: '1', rate: '', multiplier: '', amount: '', description: ''});
	const [year, setYear] = useState(String(new Date().getFullYear()));
	const [paygroup, setPaygroup] = useState('');

	const run = (label, promise, after) => {
		setBusy(label || t.working);
		setError('');
		setNotice('');
		return promise
			.then((r) => {
				setBusy('');
				if (after) after(r);
				return r;
			})
			.catch((e) => {
				setBusy('');
				setError(`${t.failed}: ${e.message}`);
			});
	};

	const reloadBoot = () =>
		run(t.loading, call({action: 'bootstrap'}), (b) => {
			setBoot(b);
			if (!subsidiary && b.subsidiaries.length) setSubsidiary(String((b.subsidiaries.find((s) => s.enabled) || b.subsidiaries[0]).id));
			if (!paygroup && b.paygroups.length) setPaygroup(String(b.paygroups[0].id));
			if (!b.setupReady) setView('setup');
		});

	useEffect(() => {
		reloadBoot();
	}, []);

	const loadBatches = (sub, per) => run(t.loading, call({action: 'batches', subsidiary: sub || subsidiary, period: per === undefined ? period : per}), (r) => setBatches(r.batches));
	const openBatch = (id) =>
		run(t.loading, call({action: 'batch', id}), (r) => {
			setBatch(r);
			setSelected(null);
			setJournal(null);
			setQuick('');
		});
	const refresh = () => (batch ? openBatch(batch.batch.id) : loadBatches());

	useEffect(() => {
		if (subsidiary && view === 'batches' && !batch) loadBatches(subsidiary, period);
		if (subsidiary && view === 'profiles') run(t.loading, call({action: 'profiles', subsidiary}), (r) => setProfiles(r.employees));
		if (subsidiary && view === 'advances') run(t.loading, call({action: 'advances', subsidiary}), (r) => setAdvances(r.advances));
	}, [subsidiary, period, view]);

	const act = (action, extra, message) => {
		const id = batch.batch.id;
		return run(t.working, post(Object.assign({action, id}, extra || {})), (r) => {
			openBatch(id).then(() => setNotice(message ? message(r) : t.done));
		});
	};

	const items = [];
	items.push(item(<ApplicationHeader title={t.title} subtitle={t.subtitle} />, 'header'));
	if (!boot) {
		items.push(item(actionRow([], [{text: error || busy || t.loading, strong: !!error}]), 'boot'));
		return (
			<StackPanel orientation={StackPanel.Orientation.VERTICAL} itemGap={StackPanel.GapSize.M} outerGap={StackPanel.GapSize.L}>
				{items}
			</StackPanel>
		);
	}

	const viewItems = Object.keys(t.views).map((k) => ({value: k, label: t.views[k]}));
	const subItems = boot.subsidiaries.map((s) => ({value: String(s.id), label: s.name}));
	const periodItems = [{value: '', label: t.allPeriods}].concat(boot.periods.map((p) => ({value: String(p.id), label: `${p.code} (${p.start} - ${p.end})`})));
	const filters = [
		cell(labeled(t.view, <Dropdown size={Dropdown.Size.L} rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(viewItems)} valueMember="value" displayMember="label" selectedValue={view} onSelectionChanged={(a) => a.value && a.value !== view && (setView(a.value), setBatch(null))} />), 'f-view'),
		cell(labeled(t.subsidiary, <Dropdown size={Dropdown.Size.L} rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(subItems)} valueMember="value" displayMember="label" selectedValue={subsidiary} onSelectionChanged={(a) => a.value && a.value !== subsidiary && (setSubsidiary(a.value), setBatch(null))} />), 'f-sub'),
	];
	if (view === 'batches' && !batch) {
		filters.push(cell(labeled(t.period, <Dropdown size={Dropdown.Size.L} rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(periodItems)} valueMember="value" displayMember="label" selectedValue={period} onSelectionChanged={(a) => a.value !== undefined && a.value !== period && setPeriod(a.value)} />), 'f-period'));
		filters.push(cell(labeled(t.description, <TextBox rootStyle={{width: '100%'}} text={description} onTextChanged={(a) => setDescription(String(a.text || ''))} />), 'f-desc'));
	}
	items.push(
		item(
			<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
				{filters}
			</GridPanel>,
			'filters'
		)
	);

	const messages = [];
	if (error) messages.push({text: error, strong: true});
	if (busy) messages.push({text: busy});
	if (notice) messages.push({text: notice});
	if (!boot.setupReady) messages.push({text: t.notReady, strong: true});
	if (boot.unverified && boot.unverified.length) messages.push({text: t.unverified(boot.unverified.join(', '))});

	// Hộp xác nhận cho thao tác ghi sổ, đảo, lập bill
	if (confirm) {
		items.push(
			item(
				actionRow(
					[
						<Button label={t.yes} hierarchy={Button.Hierarchy.PRIMARY} action={() => {
							const c = confirm;
							setConfirm(null);
							c.go();
						}} />,
						<Button label={t.cancel} action={() => setConfirm(null)} />,
					],
					[{text: confirm.text, strong: true}]
				),
				'confirm'
			)
		);
	}

	if (view === 'batches' && !batch) renderBatchList();
	else if (view === 'batches' && batch) renderBatch();
	else if (view === 'profiles') renderProfiles();
	else if (view === 'advances') renderAdvances();
	else renderSetup();

	return (
		<StackPanel orientation={StackPanel.Orientation.VERTICAL} itemGap={StackPanel.GapSize.M} outerGap={StackPanel.GapSize.L}>
			{items}
		</StackPanel>
	);

	// ------------------------------------------------------------------ danh sách bảng lương
	function renderBatchList() {
		items.push(
			item(
				actionRow(
					[
						<Button label={t.load} hierarchy={Button.Hierarchy.PRIMARY} enabled={!busy && !!subsidiary} action={() => loadBatches()} />,
						<Button label={t.newBatch} enabled={!busy && !!subsidiary && !!period && boot.setupReady} action={() =>
							run(t.working, post({action: 'createBatch', subsidiary, period, description}), (r) => openBatch(r.id))
						} />,
					],
					messages
				),
				'actions'
			)
		);
		const rows = batches.map((b) => Object.assign({}, b, {statusText: t.status[b.status] || b.status}));
		const filtered = quickFilter(rows, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={[
						{name: 'name', label: t.cols.number, width: 110, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name} type={Button.Type.LINK} action={() => openBatch(r.id)} />)},
						textCol('periodName', t.cols.period, 100, (r) => r.periodName),
						textCol('statusText', t.cols.status, 120, (r) => r.statusText),
						textCol('description', t.description, 220, (r) => r.description || ''),
						textCol('emp_count', t.cols.count, 80, (r) => r.emp_count || 0),
						moneyCol('gross', t.cols.gross, 140),
						moneyCol('ee_ins', t.cols.eeIns),
						moneyCol('er_ins', t.cols.erIns),
						moneyCol('pit', t.cols.pit),
						moneyCol('net', t.cols.net, 140),
						{name: 'journal', label: t.cols.journal, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (r.journal ? <Button label={`JE ${r.journal}`} type={Button.Type.LINK} action={() => openJournal(r.journal)} /> : plain('')))},
					]}
					columnStretch={true}
					highlightRowsOnHover={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', height: '520px'}}
				/>,
				'grid-batches'
			)
		);
	}

	function quickBox(count) {
		return (
			<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.M} alignment={StackPanel.Alignment.CENTER}>
				<StackPanel.Item key="q">
					<TextBox rootStyle={{width: '360px'}} text={quick} placeholder={t.quick} onTextChanged={(a) => setQuick(String(a.text || ''))} />
				</StackPanel.Item>
				<StackPanel.Item key="c">
					<Text size={Text.Size.S} type={Text.Type.WEAK}>
						{count === null ? '' : t.quickCount(count)}
					</Text>
				</StackPanel.Item>
			</StackPanel>
		);
	}

	// ------------------------------------------------------------------ một bảng lương
	function renderBatch() {
		const b = batch.batch;
		const s = b.status;
		const isHr = boot.user.isHr;
		const printUrl = (doc) => url.resolveScript(Object.assign({}, PRINT, {params: {batch: b.id, doc, lang: language()}}));
		const buttons = [<Button label={t.back} type={Button.Type.GHOST} action={() => (setBatch(null), loadBatches())} />, <Button label={t.actions.refresh} action={refresh} />];
		const add = (cond, label, fn, primary) => cond && buttons.push(<Button label={label} hierarchy={primary ? Button.Hierarchy.PRIMARY : Button.Hierarchy.SECONDARY} enabled={!busy} action={fn} />);
		const editable = ['H', 'B', 'C'].includes(s);
		add(editable, t.actions.loadEmployees, () => act('loadEmployees', null, t.loaded));
		add(editable, t.actions.calculate, () => act('calculate', null, t.calcDone), s === 'B');
		add(s === 'H', t.actions.removeHold, () => act('removeHold'));
		add(['B', 'C'].includes(s), t.actions.hold, () => act('hold'));
		add(['C', 'P'].includes(s) && b.calculated, t.actions.approve, () => act('approve'), s === 'C');
		add(['C', 'P'].includes(s), t.actions.reject, () => act('reject'));
		add(['A', 'J', 'P', 'C', 'B'].includes(s), t.actions.reopen, () => act('reopen'));
		add(!isHr && (s === 'A' || s === 'C') && b.calculated, t.actions.release, () => setConfirm({text: t.confirm.release, go: () => act('release', null, (r) => t.jeCreated(r.journal))}), s === 'A');
		add(!isHr && s === 'R', t.actions.reverse, () => setConfirm({text: t.confirm.reverse, go: () => act('reverse', null, (r) => t.jeCreated(r.journal))}));
		add(!isHr && s === 'R' && !(b.bills && b.bills.length), t.actions.agencyBills, () => setConfirm({text: t.confirm.agencyBills, go: () => act('agencyBills', null, t.billsCreated)}));
		add(['A', 'R'].includes(s), t.actions.bankFile, () => run(t.working, call({action: 'bankfile', id: b.id}), (r) => download(r.fileName, r.content)));
		add(b.calculated, t.actions.journal, () => run(t.loading, call({action: 'journal', id: b.id}), (r) => setJournal(r)));
		add(b.calculated, t.actions.payslips, () => window.open(printUrl('payslip'), '_blank'));
		add(b.calculated, t.actions.paymentSheet, () => window.open(printUrl('payment'), '_blank'));
		add(b.calculated && b.ctr_net, t.actions.contractor, () => window.open(printUrl('contractor'), '_blank'));
		add(true, t.openRecord, () => openRecord(boot.recordTypes.batch, b.id));
		items.push(
			item(
				<Heading type={Heading.Type.SMALL_HEADING}>{`${b.name} · ${b.periodName} (${b.periodStart} - ${b.periodEnd}) · ${t.status[s] || s}${b.description ? ` · ${b.description}` : ''}`}</Heading>,
				'b-title'
			)
		);
		const extra = [{text: t.totals(b)}];
		if (b.journal) extra.push({text: `${t.cols.journal}: JE ${b.journal}${b.reversal ? ` / ${b.reversal}` : ''}`});
		if (b.messages) extra.push({text: b.messages.split('\n').slice(0, 3).join('; '), strong: true});
		items.push(item(actionRow(buttons, messages.concat(extra)), 'b-actions'));

		const rows = batch.lines.map((l) => Object.assign({}, l, {note: [l.error, l.warnings].filter(Boolean).join(' | ')}));
		const filtered = quickFilter(rows, quick);
		const total = filtered.count === null ? null : filtered.rows.reduce((acc, r) => {
			['gross', 'exempt', 'taxable', 'ee_ins', 'er_ins', 'pit', 'other_ded', 'advance', 'net'].forEach((k) => (acc[k] = (acc[k] || 0) + (Number(r[k]) || 0)));
			return acc;
		}, {code: '', name: '∑', bold: true});
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(total ? filtered.rows.concat([total]) : filtered.rows)}
					columns={[
						{name: 'code', label: t.cols.code, width: 90, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (r.id ? <Button label={r.code || r.employee} type={Button.Type.LINK} action={() => setSelected(r.id)} /> : plain('')))},
						textCol('name', t.cols.name, 200, (r) => r.name),
						textCol('department', t.cols.dept, 120, (r) => r.department || ''),
						textCol('employment_type', t.cols.employment, 60, (r) => r.employment_type || ''),
						textCol('std_days', t.cols.std, 70, (r) => num(r.std_days)),
						textCol('work_days', t.cols.work, 70, (r) => num(r.work_days)),
						moneyCol('gross', t.cols.gross, 130),
						moneyCol('exempt', t.cols.exempt, 110),
						moneyCol('ee_ins', t.cols.eeIns, 110),
						moneyCol('er_ins', t.cols.erIns, 110),
						textCol('dependents', t.cols.deps, 50, (r) => (r.id ? r.dependents || 0 : '')),
						moneyCol('assessable', t.cols.assessable, 120),
						moneyCol('pit', t.cols.pit, 110),
						moneyCol('other_ded', t.cols.otherDed, 110),
						moneyCol('advance', t.cols.advance, 110),
						moneyCol('net', t.cols.net, 130),
						textCol('note', t.cols.warn, 260, (r) => r.note || ''),
					]}
					columnStretch={true}
					highlightRowsOnHover={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', height: selected ? '300px' : '460px'}}
				/>,
				'grid-lines'
			)
		);

		const line = selected && batch.lines.find((l) => l.id === selected);
		if (line) renderLineDetail(line);
		renderInputs(editable);
		if (journal) renderJournal();
	}

	function renderLineDetail(line) {
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{t.detailOf(line.code, line.name)}</Heading>, 'd-title'));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="minmax(420px, 3fr) minmax(360px, 2fr)" columnGap={GridPanel.GapSize.L}>
					{cell(
						<DataGrid
							dataSource={new ArrayDataSource(line.earnings)}
							columns={[
								textCol('name', t.cols.earning, 180, (r) => `${r.earningType} ${r.name || ''}`),
								textCol('quantity', t.cols.qty, 80, (r) => num(r.quantity)),
								textCol('rate', t.cols.rate, 100, (r) => num(r.rate)),
								textCol('multiplier', t.cols.mult, 60, (r) => num(r.multiplier)),
								moneyCol('amount', t.cols.amount, 120),
								moneyCol('taxExemptAmount', t.cols.exemptAmt, 110),
								textCol('source', t.cols.source, 70, (r) => `${r.source || ''} ${r.ruleCode || ''}`),
							]}
							columnStretch={true}
							placeholder={t.empty}
							rootStyle={{width: '100%', height: '220px'}}
						/>,
						'd-earn'
					)}
					{cell(
						<DataGrid
							dataSource={new ArrayDataSource(line.insurance)}
							columns={[
								textCol('code', t.cols.component, 90, (r) => r.code),
								moneyCol('wageBase', t.cols.base, 110),
								textCol('employeeRate', t.cols.eeRate, 70, (r) => pct(r.employeeRate)),
								moneyCol('employeeAmount', t.cols.eeIns, 100),
								textCol('employerRate', t.cols.erRate, 70, (r) => pct(r.employerRate)),
								moneyCol('employerAmount', t.cols.erIns, 100),
							]}
							columnStretch={true}
							placeholder={t.empty}
							rootStyle={{width: '100%', height: '220px'}}
						/>,
						'd-ins'
					)}
				</GridPanel>,
				'd-grids'
			)
		);
	}

	function renderInputs(editable) {
		const ets = boot.earningTypes || [];
		const empItems = batch.lines.map((l) => ({value: l.employee, label: `${l.code || l.employee} ${l.name || ''}`}));
		const etItems = ets.map((e) => ({value: e.id, label: `${e.code} ${e.name}`}));
		const etName = (id) => (ets.find((e) => e.id === id) || {}).code || '';
		const empName = (id) => (empItems.find((e) => e.value === id) || {}).label || id;
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{t.inputs}</Heading>, 'i-title'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(batch.inputs)}
					columns={[
						textCol('employee', t.employee, 220, (r) => empName(r.employee)),
						textCol('kind', t.cols.type, 120, (r) => t.kind[r.kind] || r.kind),
						textCol('earning_type', t.cols.earning, 120, (r) => (r.kind === 'E' ? etName(r.earning_type) : r.code || '')),
						textCol('description', t.cols.memo, 200, (r) => r.description || ''),
						textCol('qty', t.cols.qty, 80, (r) => num(r.qty)),
						textCol('rate', t.cols.rate, 100, (r) => num(r.rate)),
						textCol('multiplier', t.cols.mult, 60, (r) => num(r.multiplier)),
						moneyCol('amount', t.cols.amount, 110),
						{name: 'del', label: '', width: 70, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (editable ? <Button label={t.delete} type={Button.Type.LINK} action={() => act('deleteInput', {id: r.id})} /> : plain('')))},
					]}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', height: '200px'}}
				/>,
				'i-grid'
			)
		);
		if (!editable) return;
		const set = (k) => (a) => setInput(Object.assign({}, input, {[k]: a.value !== undefined ? a.value : String(a.text || '')}));
		const kindItems = [{value: 'E', label: t.kind.E}, {value: 'D', label: t.kind.D}];
		const fields = [
			cell(labeled(t.employee, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(empItems)} valueMember="value" displayMember="label" selectedValue={input.employee} onSelectionChanged={(a) => a.value && a.value !== input.employee && set('employee')(a)} />), 'in-emp'),
			cell(labeled(t.cols.type, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(kindItems)} valueMember="value" displayMember="label" selectedValue={input.kind} onSelectionChanged={(a) => a.value && a.value !== input.kind && set('kind')(a)} />), 'in-kind'),
			input.kind === 'E'
				? cell(labeled(t.earningType, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(etItems)} valueMember="value" displayMember="label" selectedValue={input.earning_type} onSelectionChanged={(a) => a.value && a.value !== input.earning_type && set('earning_type')(a)} />), 'in-et')
				: cell(labeled(t.deductionCode, <TextBox rootStyle={{width: '100%'}} text={input.code} onTextChanged={set('code')} />), 'in-code'),
			cell(labeled(t.cols.memo, <TextBox rootStyle={{width: '100%'}} text={input.description} onTextChanged={set('description')} />), 'in-desc'),
		];
		if (input.kind === 'E') {
			fields.push(cell(labeled(t.cols.qty, <TextBox rootStyle={{width: '100%'}} text={input.qty} onTextChanged={set('qty')} />), 'in-qty'));
			fields.push(cell(labeled(t.cols.rate, <TextBox rootStyle={{width: '100%'}} text={input.rate} onTextChanged={set('rate')} />), 'in-rate'));
			fields.push(cell(labeled(t.cols.mult, <TextBox rootStyle={{width: '100%'}} text={input.multiplier} onTextChanged={set('multiplier')} />), 'in-mult'));
		} else fields.push(cell(labeled(t.cols.amount, <TextBox rootStyle={{width: '100%'}} text={input.amount} onTextChanged={set('amount')} />), 'in-amt'));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(200px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{fields}
				</GridPanel>,
				'i-form'
			)
		);
		const numOrNull = (v) => (String(v).trim() === '' ? null : Number(String(v).replace(/\./g, '').replace(',', '.')));
		items.push(
			item(
				actionRow([
					<Button label={t.addInput} enabled={!busy && !!input.employee && (input.kind === 'D' || !!input.earning_type)} action={() =>
						act('saveInput', {values: {batch: batch.batch.id, employee: input.employee, kind: input.kind, earning_type: input.kind === 'E' ? input.earning_type : null, code: input.kind === 'D' ? input.code || 'KHAC' : '', description: input.description,
							qty: input.kind === 'E' ? numOrNull(input.qty) : null, rate: input.kind === 'E' ? numOrNull(input.rate) : null, multiplier: input.kind === 'E' ? numOrNull(input.multiplier) : null, amount: input.kind === 'D' ? numOrNull(input.amount) : null}})
					} />,
				]),
				'i-add'
			)
		);
	}

	function renderJournal() {
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{`${t.journalTitle}: ${journal.memo}`}</Heading>, 'j-title'));
		const sum = journal.lines.reduce((a, l) => ({debit: a.debit + Number(l.debit || 0), credit: a.credit + Number(l.credit || 0)}), {debit: 0, credit: 0});
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(journal.lines.concat([{account: '', memo: '∑', debit: sum.debit, credit: sum.credit, bold: true}]))}
					columns={[
						textCol('account', t.cols.account, 100, (r) => r.accountNumber || r.account),
						textCol('memo', t.cols.memo, 320, (r) => r.memo),
						moneyCol('debit', t.cols.debit, 140),
						moneyCol('credit', t.cols.credit, 140),
						textCol('sub', t.cols.dimension, 160, (r) => [r.sub, r.branch, r.workCenter, r.project].filter(Boolean).join(' / ')),
					]}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', height: '320px'}}
				/>,
				'j-grid'
			)
		);
	}

	// ------------------------------------------------------------------ hồ sơ lương
	function renderProfiles() {
		items.push(
			item(
				actionRow(
					[
						<Button label={t.actions.refresh} action={() => run(t.loading, call({action: 'profiles', subsidiary}), (r) => setProfiles(r.employees))} />,
						<Button label={t.newProfile} action={() => window.open(url.resolveRecord({recordType: boot.recordTypes.employee, isEditMode: true}), '_blank')} />,
					],
					messages
				),
				'p-actions'
			)
		);
		const rows = profiles.map((e) => Object.assign({}, e, {
			salary: e.compensation ? e.compensation.base_salary : null,
			insWage: e.compensation ? e.compensation.insurance_wage : null,
			effective: e.compensation ? e.compensation.effective : '',
			employment: e.profile ? e.profile.employment_type : '',
			pit: e.profile ? e.profile.pit_method : '',
		}));
		const filtered = quickFilter(rows, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={[
						textCol('code', t.cols.code, 100, (r) => r.code),
						textCol('name', t.cols.name, 220, (r) => r.name),
						textCol('department', t.cols.dept, 140, (r) => r.department),
						textCol('employment', t.cols.employment, 70, (r) => r.employment || ''),
						textCol('pit', t.cols.pitMethod, 60, (r) => r.pit || ''),
						moneyCol('salary', t.cols.salary, 130),
						moneyCol('insWage', t.cols.insWage, 130),
						textCol('effective', t.cols.effective, 100, (r) => r.effective || ''),
						textCol('dependents', t.cols.deps, 60, (r) => r.dependents || 0),
						{name: 'profile', label: t.cols.profile, width: 130, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (r.profile ? <Button label={t.openRecord} type={Button.Type.LINK} action={() => openRecord(boot.recordTypes.employee, r.profile.id)} /> : plain(t.noProfile)))},
					]}
					columnStretch={true}
					highlightRowsOnHover={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', height: '520px'}}
				/>,
				'p-grid'
			)
		);
	}

	// ------------------------------------------------------------------ tạm ứng
	function renderAdvances() {
		items.push(item(actionRow([<Button label={t.actions.refresh} action={() => run(t.loading, call({action: 'advances', subsidiary}), (r) => setAdvances(r.advances))} />], messages), 'a-actions'));
		const rows = advances.map((a) => Object.assign({}, a, {statusText: t.advStatus[a.status] || a.status}));
		const filtered = quickFilter(rows, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={[
						{name: 'name', label: t.cols.number, width: 110, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name} type={Button.Type.LINK} action={() => openRecord('customrecord_s4vp_advance', r.id)} />)},
						textCol('doc_date', t.cols.docDate, 100, (r) => r.doc_date),
						textCol('employee', t.employee, 100, (r) => r.employee),
						textCol('statusText', t.cols.status, 130, (r) => r.statusText),
						moneyCol('amount', t.cols.amount, 130),
						moneyCol('offset', t.cols.offset, 130),
						moneyCol('balance', t.cols.balance, 130),
						textCol('memo', t.cols.memo, 240, (r) => r.memo || ''),
						{name: 'journal', label: t.cols.journal, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (r.journal ? <Button label={`JE ${r.journal}`} type={Button.Type.LINK} action={() => openJournal(r.journal)} /> : plain('')))},
					]}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', height: '480px'}}
				/>,
				'a-grid'
			)
		);
	}

	// ------------------------------------------------------------------ thiết lập
	function renderSetup() {
		const groupItems = boot.paygroups.map((g) => ({value: String(g.id), label: `${g.code}${g.description ? ` - ${g.description}` : ''}`}));
		items.push(
			item(
				actionRow(
					[
						<Button label={t.loadDefaults} hierarchy={boot.setupReady ? Button.Hierarchy.SECONDARY : Button.Hierarchy.PRIMARY} enabled={!busy} action={() =>
							run(t.working, post({action: 'loadDefaults'}), (r) => {
								reloadBoot();
								setNotice(t.created(Object.entries(r.created).map(([k, v]) => `${v} ${k}`).join(', ') || '0'));
							})
						} />,
					],
					messages
				),
				's-defaults'
			)
		);
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[
						cell(labeled(t.year, <TextBox rootStyle={{width: '100%'}} text={year} onTextChanged={(a) => setYear(String(a.text || ''))} />), 'g-year'),
						cell(labeled(t.paygroup, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(groupItems)} valueMember="value" displayMember="label" selectedValue={paygroup} onSelectionChanged={(a) => a.value && a.value !== paygroup && setPaygroup(a.value)} />), 'g-group'),
					]}
				</GridPanel>,
				's-gen-form'
			)
		);
		items.push(
			item(
				actionRow([
					<Button label={t.generate} enabled={!busy && boot.setupReady && /^\d{4}$/.test(year) && !!paygroup} action={() =>
						run(t.working, post({action: 'generatePeriods', year: Number(year), paygroup}), (r) => {
							reloadBoot();
							setNotice(t.created(`${r.created.length} ${t.period}`));
						})
					} />,
				]),
				's-gen'
			)
		);
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{t.setupLinks}</Heading>, 's-links-title'));
		const links = [
			<Button label={t.openSetup} type={Button.Type.LINK} action={() => run(t.loading, call({action: 'lookups', subsidiary}), (r) => openRecord(boot.recordTypes.setup, r.setup.id))} />,
			<Button label={t.openCompany} type={Button.Type.LINK} action={() => run(t.loading, call({action: 'lookups', subsidiary}), (r) => (r.company ? openRecord(boot.recordTypes.company, r.company.id) : window.open(url.resolveRecord({recordType: boot.recordTypes.company, isEditMode: true}), '_blank')))} />,
		].concat(
			Object.keys(t.lists).map((k) => <Button label={t.lists[k]} type={Button.Type.LINK} action={() => boot.recordTypeIds && boot.recordTypeIds[k] && window.open(`/app/common/custom/custrecordentrylist.nl?rectype=${encodeURIComponent(boot.recordTypeIds[k])}`, '_blank')} />)
		);
		items.push(item(actionRow(links), 's-links'));
	}
}
