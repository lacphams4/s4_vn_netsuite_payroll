/**
 * Danh sách bảng lương của công ty con đang chọn (tab Chạy lương): lọc theo kỳ, tìm nhanh, bấm một dòng để vào màn
 * chạy lương của bảng đó; tạo bảng lương mới trong hộp thoại (kỳ, diễn giải) qua action createBatch.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post, openJournal} from '../lib/api.js';
import {fmtDate} from '../lib/format.js';
import {pick, serverText} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Table, Badge, Select, Field, TextInput, Dialog} from '../ui/kit.js';

const TEXT = {
	vi: {
		title: 'Chạy lương',
		sub: 'Bảng lương theo kỳ của công ty con đang chọn. Bấm một dòng để mở.',
		period: 'Kỳ lương',
		allPeriods: 'Tất cả kỳ',
		pickPeriod: 'Chọn kỳ lương',
		newBatch: 'Tạo bảng lương',
		legacy: 'Màn hình cũ',
		refresh: 'Tải lại',
		description: 'Diễn giải',
		descriptionHint: 'Ví dụ: Lương tháng 03/2027',
		create: 'Tạo',
		cancel: 'Hủy',
		loading: 'Đang tải...',
		working: 'Đang tạo bảng lương...',
		search: 'Tìm số, kỳ, diễn giải, số tiền',
		empty: 'Chưa có bảng lương nào. Bấm Tạo bảng lương để bắt đầu.',
		notReady: 'Chưa có thiết lập lương. Vào Thiết lập, bấm Nạp mặc định VN.',
		total: (n) => `Tổng ${n} bảng lương`,
		status: {H: 'Tạm giữ', B: 'Chờ tính', C: 'Đã tính', P: 'Chờ duyệt', A: 'Đã duyệt', J: 'Từ chối', R: 'Đã ghi sổ', V: 'Đã đảo'},
		step: {prepare: 'Chuẩn bị', calculate: 'Tính lương', review: 'Soát', approve: 'Duyệt', post: 'Chi lương và ghi sổ', done: 'Hoàn tất', reversed: 'Đã đảo'},
		stepOf: (n, name) => `Bước ${n}/6 - ${name}`,
		cols: {number: 'Số', period: 'Kỳ', status: 'Trạng thái', step: 'Tiến độ', description: 'Diễn giải', count: 'Số người', gross: 'Tổng thu nhập', eeIns: 'BH NLĐ', erIns: 'BH DN', pit: 'Thuế TNCN', net: 'Thực lĩnh', journal: 'Bút toán'},
	},
	en: {
		title: 'Run payroll',
		sub: 'Payroll batches by period for the selected subsidiary. Click a row to open it.',
		period: 'Pay period',
		allPeriods: 'All periods',
		pickPeriod: 'Select a pay period',
		newBatch: 'New payroll batch',
		legacy: 'Previous screen',
		refresh: 'Refresh',
		description: 'Description',
		descriptionHint: 'For example: Payroll 03/2027',
		create: 'Create',
		cancel: 'Cancel',
		loading: 'Loading...',
		working: 'Creating the payroll batch...',
		search: 'Search number, period, description, amount',
		empty: 'No payroll batches yet. Click New payroll batch to start.',
		notReady: 'Payroll preferences are missing. Open Setup and click Load VN Defaults.',
		total: (n) => `Total of ${n} batches`,
		status: {H: 'On hold', B: 'Pending calculation', C: 'Calculated', P: 'Pending approval', A: 'Approved', J: 'Rejected', R: 'Released', V: 'Reversed'},
		step: {prepare: 'Prepare', calculate: 'Calculate', review: 'Review', approve: 'Approve', post: 'Pay and post', done: 'Completed', reversed: 'Reversed'},
		stepOf: (n, name) => `Step ${n}/6 - ${name}`,
		cols: {number: 'Number', period: 'Period', status: 'Status', step: 'Progress', description: 'Description', count: 'Employees', gross: 'Gross', eeIns: 'Employee insurance', erIns: 'Employer insurance', pit: 'PIT', net: 'Net pay', journal: 'Journal'},
	},
};

const TONE = {H: 'muted', B: 'info', C: 'warn', P: 'warn', A: 'ok', J: 'error', R: 'ok', V: 'muted'};
// Bước đang làm của bảng lương suy từ trạng thái (rút gọn của core/RunSteps: danh sách không biết công đã khóa hay số cảnh báo)
const stepOf = (r) => {
	const s = String(r.status || '');
	if (s === 'R') return {key: 'done'};
	if (s === 'V') return {key: 'reversed'};
	if (s === 'A') return {n: 6, key: 'post'};
	if (s === 'P') return {n: 5, key: 'approve'};
	if (s === 'J' || (s === 'C' && r.calculated)) return {n: 4, key: 'review'};
	return Number(r.emp_count) > 0 ? {n: 3, key: 'calculate'} : {n: 1, key: 'prepare'};
};
const SUM_KEYS = ['emp_count', 'gross', 'ee_ins', 'er_ins', 'pit', 'net'];

export default function PayrollListView({app}) {
	const t = pick(TEXT);
	const boot = app.boot || {};
	const subsidiary = app.subsidiary || '';
	const periods = Array.isArray(boot.periods) ? boot.periods : [];
	const [period, setPeriod] = useState('');
	const [rows, setRows] = useState([]);
	const [dialog, setDialog] = useState(false);
	// Giá trị form giữ trong ref rồi setState: hai ô cập nhật liền nhau không ghi đè nhau
	const formRef = useRef({period: '', description: ''});
	const [form, setForm] = useState(formRef.current);
	const alive = useRef(true);
	const request = useRef(0);

	const load = () => {
		if (!subsidiary) return Promise.resolve();
		request.current += 1;
		const mine = request.current;
		return app.run(t.loading, call({action: 'batches', subsidiary, period})).then((r) => {
			// Bỏ kết quả về muộn (đã đổi bộ lọc hoặc đã rời màn)
			if (!alive.current || mine !== request.current || !r) return;
			setRows(Array.isArray(r.batches) ? r.batches : []);
		});
	};

	useEffect(() => {
		alive.current = true;
		load();
		return () => {
			alive.current = false;
		};
	}, [subsidiary, period]);

	const setField = (k) => (v) => {
		formRef.current = Object.assign({}, formRef.current, {[k]: v});
		setForm(formRef.current);
	};
	const openDialog = () => {
		formRef.current = {period: period || '', description: ''};
		setForm(formRef.current);
		setDialog(true);
	};
	const create = () => {
		const v = formRef.current;
		if (!v.period) return;
		// Lỗi phân quyền của action cũ trả ở khóa error / errorVi (không ném): đổi thành lỗi để app.run báo
		const work = post({action: 'createBatch', subsidiary, period: v.period, description: v.description}).then((r) => {
			if (r && r.error) throw {message: serverText(r.error, r.errorVi)};
			return r;
		});
		app.run(t.working, work).then((r) => {
			if (!r || !alive.current) return;
			setDialog(false);
			if (r.id) app.go('payrollRun', {id: r.id});
			else load();
		});
	};

	const periodLabel = (p) => `${p.code} (${fmtDate(p.start)} - ${fmtDate(p.end)})`;
	const periodOptions = periods.map((p) => ({value: String(p.id), label: periodLabel(p)}));
	const total = rows.length > 1 ? rows.reduce((acc, r) => {
		SUM_KEYS.forEach((k) => (acc[k] = (acc[k] || 0) + (Number(r[k]) || 0)));
		return acc;
	}, {name: t.total(rows.length)}) : null;

	// Chữ trạng thái đưa vào dữ liệu dòng để ô tìm khớp được "Đã tính", "Chờ duyệt"...
	const data = rows.map((r) => {
		const st = stepOf(r);
		return Object.assign({}, r, {statusText: t.status[r.status] || '', stepText: st.n ? t.stepOf(st.n, t.step[st.key]) : t.step[st.key]});
	});
	const columns = [
		{key: 'name', label: t.cols.number, nowrap: true, render: (r) => <span class="s4vp-link">{r.name || r.id}</span>},
		{key: 'periodName', label: t.cols.period, nowrap: true},
		{key: 'status', label: t.cols.status, nowrap: true, render: (r) => <Badge text={t.status[r.status] || r.status || ''} tone={TONE[r.status] || 'muted'} />},
		{key: 'stepText', label: t.cols.step, nowrap: true, render: (r) => <span class="s4vp-small">{r.stepText}</span>},
		{key: 'description', label: t.cols.description},
		{key: 'emp_count', label: t.cols.count, type: 'num', nowrap: true},
		{key: 'gross', label: t.cols.gross, type: 'money', nowrap: true},
		{key: 'ee_ins', label: t.cols.eeIns, type: 'money', nowrap: true},
		{key: 'er_ins', label: t.cols.erIns, type: 'money', nowrap: true},
		{key: 'pit', label: t.cols.pit, type: 'money', nowrap: true},
		{key: 'net', label: t.cols.net, type: 'money', nowrap: true},
		{key: 'journal', label: t.cols.journal, nowrap: true, noRowClick: true, render: (r) => (r.journal ? <Button kind="link" label={r.journalNo || `JE ${r.journal}`} onClick={() => openJournal(r.journal)} /> : '')},
	];

	return (
		<Page>
			<PageHeader
				title={t.title}
				sub={boot.setupReady === false ? t.notReady : t.sub}
				actions={[
					<Button label={t.legacy} kind="ghost" onClick={() => app.go('batches')} />,
					<Button label={t.refresh} onClick={() => load()} />,
					<Button label={t.newBatch} kind="primary" disabled={!subsidiary || boot.setupReady === false || !!app.busy} onClick={openDialog} />,
				]}
			/>
			<Card flush={true} label={t.title}>
				<Table
					columns={columns}
					rows={data}
					keyOf={(r) => r.id}
					onRowClick={(r) => app.go('payrollRun', {id: r.id})}
					total={total}
					empty={t.empty}
					search={true}
					searchPlaceholder={t.search}
					toolbar={<Select value={period} onInput={setPeriod} options={periodOptions} placeholder={t.allPeriods} ariaLabel={t.period} width={300} />}
				/>
			</Card>
			{dialog ? (
				<Dialog
					title={t.newBatch}
					onClose={() => setDialog(false)}
					actions={[<Button label={t.cancel} onClick={() => setDialog(false)} />, <Button label={t.create} kind="primary" disabled={!form.period || !!app.busy} onClick={create} />]}
				>
					<Field label={t.period}>
						<Select value={form.period} onInput={setField('period')} options={periodOptions} placeholder={t.pickPeriod} />
					</Field>
					<Field label={t.description} hint={t.descriptionHint}>
						<TextInput value={form.description} onInput={setField('description')} onEnter={create} />
					</Field>
				</Dialog>
			) : null}
		</Page>
	);
}
