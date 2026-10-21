/**
 * Màn hình chính "Lương VN" (S4 VN Payroll): bảng lương theo công ty con và kỳ (VP302000), hồ sơ lương (VP203000),
 * tạm ứng (VP301000), thiết lập ban đầu (Load VN Defaults, sinh kỳ). Dữ liệu và thao tác qua RESTlet
 * customscript_s4vp_rl_api; trạng thái và quyền kiểm tra phía máy chủ, nút chỉ ẩn / hiện cho gọn.
 * Thông báo hiện trên một dòng cạnh nút; lưới có ô lọc nhanh (không phân biệt dấu, mọi từ phải khớp, khớp số tiền).
 */
import {useState, useRef, useEffect, ArrayDataSource} from '@uif-js/core';
import {ApplicationHeader, StackPanel, GridPanel, Dropdown, TextBox, TextArea, Button, DataGrid, Text, Heading} from '@uif-js/component';
import url from 'N/url';
import https from 'N/https';
import runtime from 'N/runtime';

const RESTLET = {scriptId: 'customscript_s4vp_rl_api', deploymentId: 'customdeploy_s4vp_rl_api'};
const PRINT = {scriptId: 'customscript_s4vp_sl_print', deploymentId: 'customdeploy_s4vp_sl_print'};

const TEXT = {
	vi: {
		title: 'Lương VN',
		subtitle: 'S4 VN Payroll',
		views: {batches: 'Bảng lương', attendance: 'Chấm công và phép', outputs: 'Sản lượng, khoán tổ', permits: 'Giấy phép lao động', reports: 'Báo cáo, tờ khai', profiles: 'Hồ sơ lương', advances: 'Tạm ứng lương', setup: 'Thiết lập'},
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
			erInsShort: 'Trích theo lương DN', netBefore: 'Thực lĩnh trước tạm ứng', earningType: 'Loại thu nhập', project: 'Dự án', task: 'Công việc', branch: 'Địa điểm',
			workCenter: 'Phòng ban', hours: 'Số giờ', ratio: 'Tỷ lệ', advanceNbr: 'Số tạm ứng', balanceAfter: 'Số dư còn lại', document: 'Chứng từ',
		},
		actions: {
			loadEmployees: 'Nạp nhân viên', calculate: 'Tính lương', removeHold: 'Bỏ tạm giữ', hold: 'Tạm giữ', approve: 'Duyệt', reject: 'Từ chối', reopen: 'Mở lại',
			release: 'Ghi sổ', reverse: 'Đảo', agencyBills: 'Lập bill cơ quan thu', bankFile: 'File chi lương', payslips: 'In phiếu lương', paymentSheet: 'In bảng thanh toán',
			contractor: 'In quyết toán CTV', journal: 'Xem bút toán', refresh: 'Tải lại',
			completeRelease: 'Hoàn tất ghi sổ', completeReverse: 'Hoàn tất đảo', clearJob: 'Gỡ khóa tác vụ (admin)',
		},
		resumed: 'Đã hoàn tất các bước còn thiếu',
		confirm: {release: 'Ghi sổ bảng lương này? Hệ thống tạo bút toán và cấn trừ tạm ứng.', reverse: 'Đảo bảng lương này? Hệ thống tạo bút toán đảo và hoàn số dư tạm ứng.', agencyBills: 'Lập bill nộp cơ quan BHXH, công đoàn, thuế?'},
		detailOf: (c, n) => `Chi tiết ${c} ${n}`,
		employeesTitle: (n) => `Nhân viên (${n})`,
		tabs: {earn: 'Thu nhập', ded: 'Khấu trừ khác', ins: 'Bảo hiểm', att: 'Công', alloc: 'Phân bổ dự án', adv: 'Cấn trừ tạm ứng', journal: 'Bút toán', bills: 'Bill cơ quan thu'},
		batchTabs: 'Cả bảng lương:',
		batchDetail: 'Cả bảng lương',
		noLine: 'Chưa có nhân viên, bấm Nạp nhân viên',
		src: {S: 'Hệ thống', T: 'Giờ công', M: 'Nhập tay', O: 'Sản lượng'},
		allocSrc: {P: 'Bảng tỷ lệ', T: 'Giờ công', R: 'Theo tổ', D: 'Mặc định', S: 'Sản lượng'},
		inputHint: {E: 'Thêm thu nhập nhập tay cho nhân viên đang chọn (số tiền = số lượng × đơn giá × hệ số), sau đó bấm Tính lương.', D: 'Thêm khoản khấu trừ sau thuế cho nhân viên đang chọn, sau đó bấm Tính lương.'},
		attCols: {std_days: 'Công chuẩn', work_days: 'Công hưởng lương', paid_leave: 'Nghỉ có lương', unpaid_leave: 'Nghỉ không lương', si_leave: 'Nghỉ ốm, thai sản (BHXH)', absence_days: 'Ngày nghỉ xét đóng BH', ot_hours: 'Giờ làm thêm', att_locked: 'Công đã khóa'},
		journalNotReady: 'Bảng lương chưa tính, chưa có bút toán dự kiến',
		addInput: 'Thêm dòng',
		kind: {E: 'Thu nhập', D: 'Khấu trừ sau thuế'},
		employee: 'Nhân viên',
		earningType: 'Loại thu nhập',
		deductionCode: 'Mã khấu trừ',
		delete: 'Xóa',
		journalTitle: 'Bút toán dự kiến (chưa ghi sổ)',
		journalTitleReleased: 'Bút toán theo bảng lương (đối chiếu với JE đã ghi sổ)',
		totals: (b) => `Tổng thu nhập ${money(b.gross || 0)} · BH NLĐ ${money(b.ee_ins || 0)} · BH DN ${money(b.er_ins || 0)} · Thuế ${money(b.pit || 0)} · Thực lĩnh ${money(b.net || 0)}`,
		netWords: (w) => `Thực lĩnh nhân viên bằng chữ: ${w}`,
		unverified: (list) => `Tham số chưa đối chiếu văn bản gốc, cần kế toán trưởng duyệt: ${list}`,
		unverifiedShort: (n) => `${n} tham số pháp lý chưa đối chiếu văn bản gốc (xem Thiết lập)`,
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
		txPosted: 'đã ghi sổ',
		txPending: 'chưa ghi sổ, chờ duyệt',
		txVoided: 'đã hủy',
		reversalLabel: 'đảo',
		billsLabel: 'Bill cơ quan thu',
		att: {
			build: 'Lập bảng công', lock: 'Khóa công', unlock: 'Mở khóa công', summary: 'Bảng tổng hợp công', docs: 'Chứng từ', docType: 'Loại chứng từ',
			types: {leave: 'Đơn nghỉ', ot: 'Đơn làm thêm giờ', trip: 'Đơn công tác', exception: 'Phiếu ngoại lệ chấm công'},
			reqStatus: {H: 'Tạm giữ', P: 'Chờ duyệt', A: 'Đã duyệt', R: 'Từ chối', C: 'Đã hủy'},
			ops: {submit: 'Gửi duyệt', approve: 'Duyệt', reject: 'Từ chối', cancel: 'Hủy'},
			newDoc: 'Lập chứng từ', save: 'Lưu (tạm giữ)', from: 'Từ ngày (yyyy-mm-dd)', to: 'Đến ngày (yyyy-mm-dd)', workDate: 'Ngày (yyyy-mm-dd)',
			hours: 'Số giờ', minutes: 'Số phút', adjust: 'Điều chỉnh công (-1..1)', reason: 'Lý do', leaveType: 'Loại nghỉ', destination: 'Nơi công tác',
			advanceAmount: 'Số tiền tạm ứng', exceptionType: 'Loại ngoại lệ', exTypes: {L: 'Đi trễ', E: 'Về sớm', A: 'Điều chỉnh công'},
			half: {A: 'Buổi sáng', P: 'Buổi chiều'}, fromHalf: 'Bắt đầu', toHalf: 'Kết thúc', days: 'Số ngày', dayUnit: 'ngày', dayType: 'Loại ngày',
			accrue: 'Cấp phép năm', expire: 'Hết hạn phép chuyển', balances: 'Số dư phép', year: 'Năm',
			cols: {std: 'Công chuẩn', paid: 'Nghỉ có lương', unpaid: 'Không lương', si: 'BHXH', trip: 'Công tác', late: 'Trừ trễ sớm', adj: 'Điều chỉnh', work: 'Công hưởng lương', ot: 'Giờ OT', status: 'Trạng thái',
				entitled: 'Được cấp', carried: 'Chuyển', adjusted: 'Điều chỉnh', used: 'Đã dùng', pending: 'Chờ duyệt', available: 'Còn lại'},
			punches: 'Chấm công máy', punchHint: 'Mỗi dòng: mã nhân viên, thời điểm YYYY-MM-DD HH:mm, thiết bị (cách nhau dấu phẩy). Xử lý chấm công sinh phiếu trễ / sớm / vắng và đơn OT gợi ý ở trạng thái Tạm giữ, không tự trừ lương.',
			importPunches: 'Nạp lượt chấm', processPunches: 'Xử lý chấm công kỳ đang chọn',
			punchResult: (r) => `Nạp ${r.created} lượt, bỏ qua ${r.skipped}${r.errors && r.errors.length ? `, lỗi: ${r.errors.slice(0, 3).map((e) => e.message || e).join('; ')}` : ''}`,
			processResult: (r) => `Đã xử lý ${r.employees} người: ${r.exceptions} phiếu ngoại lệ, ${r.overtime} đơn OT gợi ý (thay ${r.deleted} chứng từ của lần trước, giữ ${r.kept})`,
			accrued: (rows) => `Đã cấp phép: ${rows.filter((r) => r.accrued).length} người${rows.some((r) => r.message) ? ` · ${rows.filter((r) => r.message).map((r) => r.message).join('; ')}` : ''}`,
		},
		out: {
			entries: 'Phiếu sản lượng', type: {I: 'Cá nhân', T: 'Tổ'}, status: {H: 'Tạm giữ', P: 'Chờ duyệt', A: 'Đã duyệt', C: 'Đã vào bảng lương'},
			ops: {submit: 'Gửi duyệt', approve: 'Duyệt', hold: 'Tạm giữ', split: 'Chia tiền tổ', members: 'Nạp thành viên tổ'},
			cols: {date: 'Ngày', type: 'Loại', table: 'Bảng đơn giá', team: 'Tổ', total: 'Thành tiền', split: 'Đã chia', lines: 'Dòng sản lượng', members: 'Thành viên'},
			hint: 'Lập phiếu, dòng sản lượng, thành viên trên màn hình NetSuite (Mở bản ghi) hoặc qua API saveOutput; màn hình này để duyệt, chia tổ và theo dõi.',
		},
		wp: {
			status: {D: 'Đang chuẩn bị', S: 'Đã nộp', A: 'Còn hiệu lực', E: 'Hết hạn', V: 'Thu hồi'},
			ops: {submit: 'Nộp', issue: 'Đã cấp', revoke: 'Thu hồi', extend: 'Tạo gia hạn'},
			cols: {no: 'Số giấy', effective: 'Hiệu lực', expiry: 'Hết hạn', left: 'Còn (ngày)', issue: 'Loại cấp'},
			issueType: {N: 'Cấp mới', X: 'Gia hạn', R: 'Cấp lại'},
			updateExpired: 'Cập nhật giấy hết hạn',
			permitNo: 'Số giấy phép', issued: 'Ngày cấp (yyyy-mm-dd)',
		},
		rep: {
			type: 'Báo cáo', types: {insurance: 'Bảng BH phải nộp và D02-LT (VP402000)', pitq: 'Tờ khai 05/KK-TNCN theo quý (VP403000)', pita: 'Dữ liệu quyết toán TNCN năm 05-1/BK, 05-2/BK (VP404000)', cost: 'Chi phí nhân sự theo tài khoản, đối chiếu GL (VP405000)'},
			taxMonth: 'Tháng tính thuế (yyyyMM)', year: 'Năm', quarter: 'Quý', schedule: 'Bảng kê', c12: 'Số trên thông báo C12-TS', releasedOnly: 'Chỉ bảng lương đã ghi sổ',
			yesNo: {T: 'Có', F: 'Không'}, run: 'Xem', csv: 'Xuất CSV', d02: 'Danh sách biến động D02-LT', indicators: 'Chỉ tiêu tờ khai', c12Diff: (a, d) => `Thông báo C12-TS ${money(a)} · Chênh lệch ${money(d)}`,
			code: 'Chỉ tiêu', item: 'Nội dung', value: 'Giá trị',
		},
		yes: 'Đồng ý',
		cancel: 'Hủy',
	},
	en: {},
};
// Bản tiếng Anh: nhãn gốc theo Acumatica
TEXT.en = Object.assign({}, TEXT.vi, {
	title: 'VN Payroll',
	views: {batches: 'Payroll Batches', attendance: 'Attendance and Leave', outputs: 'Output Entries', permits: 'Work Permits', reports: 'Reports and Declarations', profiles: 'Employee Payroll Profiles', advances: 'Payroll Advances', setup: 'Setup'},
	view: 'Screen', subsidiary: 'Subsidiary', period: 'Pay period', allPeriods: '(All periods)', load: 'View', newBatch: 'New batch', description: 'Description',
	quick: 'Quick filter (name, code, amount...)', quickCount: (n) => `${n} matching rows`, empty: 'No data', loading: 'Loading...', working: 'Working...', done: 'Done', failed: 'Error',
	back: 'Back to list', openRecord: 'Open record',
	status: {H: 'On Hold', B: 'Pending Calculation', C: 'Calculated', P: 'Pending Approval', A: 'Approved', J: 'Rejected', R: 'Released', V: 'Reversed'},
	advStatus: {H: 'On Hold', B: 'Pending Release', O: 'Open for Offset', C: 'Settled'},
	actions: {
		loadEmployees: 'Load Employees', calculate: 'Calculate', removeHold: 'Remove Hold', hold: 'Hold', approve: 'Approve', reject: 'Reject', reopen: 'Reopen', release: 'Release',
		reverse: 'Reverse', agencyBills: 'Create Agency Bills', bankFile: 'Export Bank File', payslips: 'Print Payslips', paymentSheet: 'Print Payment Sheet',
		contractor: 'Print Contractor Settlement', journal: 'Preview Journal', refresh: 'Refresh',
		completeRelease: 'Complete Release', completeReverse: 'Complete Reversal', clearJob: 'Clear job lock (admin)',
	},
	resumed: 'Remaining steps completed',
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

const item = (child, key) => (
	<StackPanel.Item key={key} shrink={0}>
		{child}
	</StackPanel.Item>
);

// Ngày hôm nay theo giờ máy người dùng (toISOString là UTC, lệch ngày vào buổi sáng ở Việt Nam)
const localToday = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function actionRow(buttons, messages) {
	const parts = [];
	buttons.forEach((b, i) => parts.push(item(b, `btn-${i}`)));
	const list = (messages || []).filter((m) => m && m.text);
	if (list.length) {
		parts.push(
			item(
				<Text size={Text.Size.S} rootStyle={{whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%'}} type={list.some((m) => m.strong) ? Text.Type.STRONG : Text.Type.WEAK}>
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

const EMPTY_INPUT = {earning_type: '', code: '', qty: '1', rate: '', multiplier: '', amount: '', description: ''};

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
	const [tab, setTab] = useState('earn');
	const [input, setInput] = useState(EMPTY_INPUT);
	const inputRef = useRef(input);
	const [year, setYear] = useState(String(new Date().getFullYear()));
	const [paygroup, setPaygroup] = useState('');
	const [attPeriod, setAttPeriod] = useState('');
	const [attRows, setAttRows] = useState([]);
	const [docType, setDocType] = useState('leave');
	const [docs, setDocs] = useState([]);
	const [balances, setBalances] = useState([]);
	const [employees, setEmployees] = useState([]);
	const docRef = useRef({});
	const [docForm, setDocForm] = useState({});
	const [repType, setRepType] = useState('insurance');
	const repRef = useRef({taxMonth: '', year: String(new Date().getFullYear()), quarter: String(Math.floor(new Date().getMonth() / 3) + 1), schedule: '', c12: '', releasedOnly: 'F'});
	const [repForm, setRepForm] = useState(repRef.current);
	const [report, setReport] = useState(null);
	const [outputs, setOutputs] = useState([]);
	const [outPeriod, setOutPeriod] = useState('');
	const [permits, setPermits] = useState([]);
	const wpRef = useRef({permitNo: '', issued: ''});
	const [wpForm, setWpForm] = useState(wpRef.current);

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
	// keep: giữ nhân viên, tab và ô lọc đang chọn khi tải lại sau một thao tác trên cùng bảng lương
	const openBatch = (id, keep) =>
		run(t.loading, call({action: 'batch', id}), (r) => {
			setBatch(r);
			setJournal(null);
			if (!keep) {
				setSelected(null);
				setTab('earn');
				setQuick('');
			}
		});
	const refresh = () => (batch ? openBatch(batch.batch.id, true) : loadBatches());

	useEffect(() => {
		if (subsidiary && view === 'batches' && !batch) loadBatches(subsidiary, period);
		if (subsidiary && view === 'profiles') run(t.loading, call({action: 'profiles', subsidiary}), (r) => setProfiles(r.employees));
		if (subsidiary && view === 'advances') run(t.loading, call({action: 'advances', subsidiary}), (r) => setAdvances(r.advances));
		if (subsidiary && view === 'outputs') run(t.loading, call({action: 'outputs', subsidiary, period: outPeriod}), (r) => setOutputs(r.outputs));
		if (subsidiary && view === 'permits') run(t.loading, call({action: 'workPermits', subsidiary}), (r) => setPermits(r.permits));
		if (subsidiary && (view === 'outputs' || view === 'permits') && !employees.length) call({action: 'profiles', subsidiary}).then((r) => setEmployees(r.employees.filter((e) => e.profile))).catch(() => {});
		if (subsidiary && view === 'attendance') {
			loadDocs(docType);
			call({action: 'profiles', subsidiary}).then((r) => setEmployees(r.employees.filter((e) => e.profile))).catch(() => {});
		}
	}, [subsidiary, period, view]);

	const loadDocs = (type) => run(t.loading, call({action: 'docs', type, subsidiary}), (r) => setDocs(r.docs));
	const loadAttendance = (per) => per && run(t.loading, call({action: 'attendance', period: per}), (r) => setAttRows(r.rows));
	const setDoc = (k) => (a) => {
		docRef.current = Object.assign({}, docRef.current, {[k]: a.value !== undefined ? a.value : String(a.text || '')});
		setDocForm(docRef.current);
	};
	const setRep = (k) => (a) => {
		repRef.current = Object.assign({}, repRef.current, {[k]: a.value !== undefined ? a.value : String(a.text || '')});
		setRepForm(repRef.current);
	};

	const act = (action, extra, message, keep) => {
		const id = batch.batch.id;
		return run(t.working, post(Object.assign({action, id}, extra || {})), (r) => {
			const warn = ((r && r.warnings) || []).map((w) => (language() === 'vi' ? w.messageVi || w.message : w.message || w.messageVi)).filter(Boolean);
			return openBatch(id, keep).then(() => setNotice([message ? message(r) : t.done].concat(warn).join(' · ')));
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
	if (boot.unverified && boot.unverified.length) messages.push({text: view === 'setup' ? t.unverified(boot.unverified.join(', ')) : t.unverifiedShort(boot.unverified.length)});

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
	else if (view === 'attendance') renderAttendance();
	else if (view === 'reports') renderReports();
	else if (view === 'outputs') renderOutputs();
	else if (view === 'permits') renderPermits();
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
					rootStyle={{width: '100%', flexShrink: 0, height: '520px'}}
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
		// Hoàn tất khi lần trước dừng giữa chừng (sau khi tạo JE / bill): máy chủ chỉ làm phần còn thiếu
		add(!isHr && s === 'R', t.actions.completeRelease, () => act('release', null, (r) => (r.resumed ? t.resumed : t.jeCreated(r.journal))));
		add(!isHr && s === 'V', t.actions.completeReverse, () => act('reverse', null, (r) => (r.resumed ? t.resumed : t.jeCreated(r.journal))));
		add(boot.user.role === 'administrator' && !!b.job, t.actions.clearJob, () => act('clearJob'));
		add(!isHr && s === 'R', t.actions.agencyBills, () => setConfirm({text: t.confirm.agencyBills, go: () => act('agencyBills', null, t.billsCreated)}));
		add(['A', 'R'].includes(s), t.actions.bankFile, () => run(t.working, call({action: 'bankfile', id: b.id}), (r) => download(r.fileName, r.content)));
		add(b.calculated, t.actions.journal, () => run(t.loading, call({action: 'journal', id: b.id}), (r) => (setJournal(r), setTab('journal'))));
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
		const tx = batch.transactions || {};
		const txText = (id) => {
			const x = tx[id] || {};
			const state = x.voided ? t.txVoided : x.posting ? t.txPosted : t.txPending;
			return `${x.tranid || id} (${state})`;
		};
		if (b.journal) extra.push({text: `${t.cols.journal}: ${txText(b.journal)}${b.reversal ? ` / ${t.reversalLabel} ${txText(b.reversal)}` : ''}`});
		const bills = Array.isArray(b.bills) ? b.bills : [];
		if (bills.length) extra.push({text: `${t.billsLabel}: ${bills.map((x) => txText(x.id)).join(', ')}`});
		if (b.messages) extra.push({text: b.messages.split('\n').slice(0, 3).join('; '), strong: true});
		items.push(item(actionRow(buttons, messages), 'b-actions'));
		items.push(item(<Text size={Text.Size.S} rootStyle={{whiteSpace: 'normal'}}>{extra.map((m) => m.text).join('  ·  ')}</Text>, 'b-totals'));

		// Lưới cha: mỗi nhân viên một dòng; bấm mã nhân viên để xem các tab chi tiết bên dưới (như VP302000)
		const current = batch.lines.find((l) => l.id === selected) || batch.lines[0] || null;
		const rows = batch.lines.map((l) => Object.assign({}, l, {note: [l.error, l.warnings].filter(Boolean).join(' | ')}));
		const filtered = quickFilter(rows, quick);
		const sumKeys = ['gross', 'exempt', 'ee_ins', 'er_ins', 'family_ded', 'assessable', 'pit', 'other_ded', 'net_before', 'advance', 'net'];
		const total = filtered.rows.length > 1 ? sumRow(filtered.rows, sumKeys, {code: '', name: '∑', bold: true}) : null;
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{t.employeesTitle(batch.lines.length)}</Heading>, 'e-title'));
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(total ? filtered.rows.concat([total]) : filtered.rows)}
					columns={[
						{name: 'code', label: t.cols.code, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (r.id ? <Button label={`${current && r.id === current.id ? '▸ ' : ''}${r.code || r.employee}`} type={Button.Type.LINK} action={() => setSelected(r.id)} /> : plain('')))},
						textCol('name', t.cols.name, 190, (r) => r.name),
						textCol('employment_type', t.cols.employment, 60, (r) => r.employment_type || ''),
						textCol('std_days', t.cols.std, 70, (r) => num(r.std_days)),
						textCol('work_days', t.cols.work, 70, (r) => num(r.work_days)),
						moneyCol('gross', t.cols.gross, 120),
						moneyCol('exempt', t.cols.exempt, 105),
						moneyCol('ee_ins', t.cols.eeIns, 100),
						moneyCol('er_ins', t.cols.erInsShort, 100),
						textCol('dependents', t.cols.deps, 45, (r) => (r.id ? r.dependents || 0 : '')),
						moneyCol('family_ded', t.cols.family, 110),
						moneyCol('assessable', t.cols.assessable, 110),
						moneyCol('pit', t.cols.pit, 100),
						moneyCol('other_ded', t.cols.otherDed, 100),
						moneyCol('net_before', t.cols.netBefore, 120),
						moneyCol('advance', t.cols.advance, 100),
						moneyCol('net', t.cols.net, 120),
						textCol('note', t.cols.warn, 240, (r) => r.note || ''),
					]}
					columnStretch={true}
					highlightRowsOnHover={true}
					placeholder={t.empty}
					on={{[DataGrid.Event.CURSOR_UPDATED]: pickLine}}
					rootStyle={{width: '100%', flexShrink: 0, height: '300px'}}
				/>,
				'grid-lines'
			)
		);
		renderDetailTabs(current, editable, bills, txText);
	}

	// Bấm ô bất kỳ trên dòng nhân viên (con trỏ lưới đổi dòng) thì các tab bên dưới chuyển sang nhân viên đó
	// UIF gọi (args, sender): sender là lưới, con trỏ của lưới cho dòng vừa bấm
	function pickLine(args, grid) {
		try {
			const row = (grid && grid.cursor && grid.cursor.row) || (args && (args.row || (args.cell && args.cell.row))) || null;
			const r = row && row.dataItem;
			if (r && r.id) setSelected(r.id);
		} catch (err) {
			// bỏ qua: vẫn chọn được bằng mã nhân viên
		}
	}

	function sumRow(list, keys, base) {
		return list.reduce((acc, r) => {
			keys.forEach((k) => (acc[k] = (acc[k] || 0) + (Number(r[k]) || 0)));
			return acc;
		}, Object.assign({}, base));
	}

	// Các tab con: sáu tab của nhân viên đang chọn, hai tab của cả bảng lương
	function renderDetailTabs(line, editable, bills, txText) {
		const lineTabs = ['earn', 'ded', 'ins', 'att', 'alloc', 'adv'];
		const strip = [];
		const tabButton = (k) => <Button label={t.tabs[k]} hierarchy={tab === k ? Button.Hierarchy.PRIMARY : Button.Hierarchy.SECONDARY} type={tab === k ? Button.Type.PRIMARY : Button.Type.GHOST} action={() => pickTab(k)} />;
		lineTabs.forEach((k) => strip.push(tabButton(k)));
		strip.push(<Text type={Text.Type.WEAK}>{t.batchTabs}</Text>);
		['journal', 'bills'].forEach((k) => strip.push(tabButton(k)));
		const isLineTab = lineTabs.includes(tab);
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{isLineTab ? (line ? t.detailOf(line.code, line.name) : t.noLine) : t.batchDetail}</Heading>, 'd-title'));
		items.push(item(actionRow(strip), 'd-tabs'));
		if (tab === 'journal') return renderJournalTab();
		if (tab === 'bills') return renderBills(bills, txText);
		if (!line) return;
		if (tab === 'earn') renderEarnings(line, editable);
		else if (tab === 'ded') renderDeductions(line, editable);
		else if (tab === 'ins') renderInsurance(line);
		else if (tab === 'att') renderLineAttendance(line);
		else if (tab === 'alloc') renderAllocations(line);
		else renderOffsets(line);
	}

	function pickTab(k) {
		setTab(k);
		if (k === 'journal' && !journal && batch.batch.calculated) run(t.loading, call({action: 'journal', id: batch.batch.id}), (r) => setJournal(r));
	}

	// columnStretch không giãn cột khi tổng bề rộng nhỏ hơn khung: nhân bề rộng cột theo bề ngang cửa sổ để lưới phủ hết trang
	function detailGrid(rows, columns, key, height) {
		const sum = columns.reduce((a, c) => a + (c.width || 0), 0);
		const factor = sum ? Math.max(1, (window.innerWidth - 120) / sum) : 1;
		return item(
			<DataGrid
				dataSource={new ArrayDataSource(rows)}
				columns={columns.map((c) => Object.assign({}, c, {width: Math.floor((c.width || 0) * factor)}))}
				columnStretch={true}
				placeholder={t.empty}
				rootStyle={{width: '100%', flexShrink: 0, height: height || '260px'}}
			/>,
			key
		);
	}

	function myInputs(line, kind) {
		return (batch.inputs || []).filter((i) => i.employee === line.employee && i.kind === kind);
	}

	function delCol(editable) {
		return {name: 'del', label: '', width: 60, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (editable && r.inputId ? <Button label={t.delete} type={Button.Type.LINK} action={() => act('deleteInput', {id: r.inputId}, null, true)} /> : plain('')))};
	}

	function inputAmount(i) {
		const blankV = (v) => v === null || v === undefined || v === '';
		return !blankV(i.amount) ? Number(i.amount) : (Number(i.qty) || 0) * (Number(i.rate) || 0) * (blankV(i.multiplier) ? 1 : Number(i.multiplier));
	}

	// Thu nhập: dòng hệ thống sinh và dòng nhập tay chung một lưới, cột Nguồn phân biệt (như tab Thu nhập của VP302000)
	function renderEarnings(line, editable) {
		const ets = boot.earningTypes || [];
		const etOf = (id) => ets.find((e) => e.id === id) || {};
		const calc = (line.earnings || []).filter((x) => x.source !== 'M');
		const manualCalc = (line.earnings || []).filter((x) => x.source === 'M');
		const inputs = myInputs(line, 'E');
		const rows = calc.map((x) => ({type: x.earningType, memo: x.name || '', quantity: x.quantity, rate: x.rate, multiplier: x.multiplier, amount: x.amount, exempt: x.taxExemptAmount, src: `${t.src[x.source] || x.source || ''}${x.ruleCode ? ` · ${x.ruleCode}` : ''}`, project: x.project || ''}));
		inputs.forEach((i, n) => {
			// Dòng nhập tay sau khi tính có phần miễn thuế; khớp theo thứ tự nạp vào bộ tính
			const m = manualCalc.length === inputs.length ? manualCalc[n] : null;
			rows.push({inputId: i.id, type: etOf(i.earning_type).code || '', memo: i.description || etOf(i.earning_type).name || '', quantity: i.qty, rate: i.rate, multiplier: i.multiplier, amount: m ? m.amount : inputAmount(i), exempt: m ? m.taxExemptAmount : null, src: t.src.M, project: ''});
		});
		if (rows.length > 1) rows.push(sumRow(rows, ['amount', 'exempt'], {type: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('type', t.cols.earningType, 110, (r) => r.type),
				textCol('memo', t.cols.memo, 220, (r) => r.memo),
				textCol('quantity', t.cols.qty, 80, (r) => num(r.quantity)),
				textCol('rate', t.cols.rate, 110, (r) => num(r.rate)),
				textCol('multiplier', t.cols.mult, 60, (r) => num(r.multiplier)),
				moneyCol('amount', t.cols.amount, 120),
				moneyCol('exempt', t.cols.exemptAmt, 110),
				textCol('src', t.cols.source, 140, (r) => r.src),
				textCol('project', t.cols.project, 100, (r) => r.project),
				delCol(editable),
			], 'd-earn')
		);
		if (!editable) return;
		const etItems = ets.map((e) => ({value: e.id, label: `${e.code} ${e.name}`}));
		inputForm(line, 'E', [
			cell(labeled(t.earningType, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(etItems)} valueMember="value" displayMember="label" selectedValue={input.earning_type} onSelectionChanged={(a) => a.value && a.value !== input.earning_type && setField('earning_type')(a)} />), `in-et-${input.rev || 0}`),
			cell(labeled(t.cols.memo, <TextBox rootStyle={{width: '100%'}} text={input.description} onTextChanged={setField('description')} />), 'in-desc'),
			cell(labeled(t.cols.qty, <TextBox rootStyle={{width: '100%'}} text={input.qty} onTextChanged={setField('qty')} />), 'in-qty'),
			cell(labeled(t.cols.rate, <TextBox rootStyle={{width: '100%'}} text={input.rate} onTextChanged={setField('rate')} />), 'in-rate'),
			cell(labeled(t.cols.mult, <TextBox rootStyle={{width: '100%'}} text={input.multiplier} placeholder="1" onTextChanged={setField('multiplier')} />), 'in-mult'),
		]);
	}

	// Khấu trừ khác (sau thuế): chỉ có dòng nhập tay
	function renderDeductions(line, editable) {
		const rows = myInputs(line, 'D').map((i) => ({inputId: i.id, code: i.code || '', memo: i.description || '', amount: i.amount}));
		if (rows.length > 1) rows.push(sumRow(rows, ['amount'], {code: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('code', t.deductionCode, 120, (r) => r.code),
				textCol('memo', t.cols.memo, 320, (r) => r.memo),
				moneyCol('amount', t.cols.amount, 130),
				delCol(editable),
			], 'd-ded', '200px')
		);
		if (!editable) return;
		inputForm(line, 'D', [
			cell(labeled(t.deductionCode, <TextBox rootStyle={{width: '100%'}} text={input.code} placeholder="KHAC" onTextChanged={setField('code')} />), 'in-code'),
			cell(labeled(t.cols.memo, <TextBox rootStyle={{width: '100%'}} text={input.description} onTextChanged={setField('description')} />), 'in-desc'),
			cell(labeled(t.cols.amount, <TextBox rootStyle={{width: '100%'}} text={input.amount} onTextChanged={setField('amount')} />), 'in-amt'),
		]);
	}

	// Form thêm dòng nhập tay cho đúng nhân viên đang chọn; giá trị giữ trong ref để hai ô cập nhật liền nhau không ghi đè nhau
	function setField(k) {
		return (a) => {
			inputRef.current = Object.assign({}, inputRef.current, {[k]: a.value !== undefined ? a.value : String(a.text || '')});
			setInput(inputRef.current);
		};
	}

	function inputForm(line, kind, fields) {
		items.push(item(<Text size={Text.Size.S} type={Text.Type.WEAK}>{t.inputHint[kind]}</Text>, `i-hint-${kind}`));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(180px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{fields}
				</GridPanel>,
				`i-form-${kind}`
			)
		);
		const numOrNull = (v) => (String(v === undefined || v === null ? '' : v).trim() === '' ? null : Number(String(v).replace(/\./g, '').replace(',', '.')));
		const ready = kind === 'D' || !!input.earning_type;
		items.push(
			item(
				actionRow([
					<Button label={t.addInput} hierarchy={Button.Hierarchy.PRIMARY} enabled={!busy && ready} action={() => {
						const v = inputRef.current;
						const values = {batch: batch.batch.id, employee: line.employee, kind, earning_type: kind === 'E' ? v.earning_type : null, code: kind === 'D' ? v.code || 'KHAC' : '', description: v.description,
							qty: kind === 'E' ? numOrNull(v.qty) : null, rate: kind === 'E' ? numOrNull(v.rate) : null, multiplier: kind === 'E' ? numOrNull(v.multiplier) : null, amount: kind === 'D' ? numOrNull(v.amount) : null};
						// Chỉ xóa form khi lưu được; rev đổi khóa ô chọn để Dropdown dựng lại ở trạng thái trống
						return act('saveInput', {values}, null, true).then((r) => {
							if (!r) return;
							inputRef.current = Object.assign({}, EMPTY_INPUT, {rev: (v.rev || 0) + 1});
							setInput(inputRef.current);
						});
					}} />,
				]),
				`i-add-${kind}`
			)
		);
	}

	function renderInsurance(line) {
		const rows = (line.insurance || []).slice();
		if (rows.length > 1) rows.push(sumRow(rows, ['employeeAmount', 'employerAmount'], {code: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('code', t.cols.component, 110, (r) => r.code),
				moneyCol('wageBase', t.cols.base, 130),
				textCol('employeeRate', t.cols.eeRate, 80, (r) => pct(r.employeeRate)),
				moneyCol('employeeAmount', t.cols.eeIns, 120),
				textCol('employerRate', t.cols.erRate, 80, (r) => pct(r.employerRate)),
				moneyCol('employerAmount', t.cols.erIns, 120),
			], 'd-ins')
		);
	}

	// Công: số liệu công của dòng (từ bảng tổng hợp công nếu đã lập, ngược lại công chuẩn trừ ngày ngoài hợp đồng)
	function renderLineAttendance(line) {
		const rows = [
			['std_days', num(line.std_days)], ['work_days', num(line.work_days)], ['paid_leave', num(line.paid_leave)], ['unpaid_leave', num(line.unpaid_leave)],
			['si_leave', num(line.si_leave)], ['absence_days', num(line.absence_days)], ['ot_hours', num(line.ot_hours)], ['att_locked', t.rep.yesNo[line.att_locked ? 'T' : 'F']],
		].map(([k, v]) => ({label: t.attCols[k], value: v}));
		items.push(detailGrid(rows, [textCol('label', t.rep.item, 260, (r) => r.label), textCol('value', t.rep.value, 140, (r) => r.value)], 'd-att', '300px'));
	}

	function renderAllocations(line) {
		const rows = (line.allocations || []).slice();
		if (rows.length > 1) rows.push(sumRow(rows, ['amount'], {component: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('component', t.cols.component, 100, (r) => r.component),
				textCol('project', t.cols.project, 120, (r) => r.project || ''),
				textCol('task', t.cols.task, 100, (r) => r.task || ''),
				textCol('branch', t.cols.branch, 100, (r) => r.branch || ''),
				textCol('workCenter', t.cols.workCenter, 100, (r) => r.workCenter || ''),
				textCol('source', t.cols.source, 110, (r) => (r.source ? t.allocSrc[r.source] || r.source : '')),
				textCol('hours', t.cols.hours, 70, (r) => num(r.hours)),
				textCol('ratio', t.cols.ratio, 80, (r) => pct(r.ratio)),
				moneyCol('amount', t.cols.amount, 120),
			], 'd-alloc')
		);
	}

	function renderOffsets(line) {
		const rows = (line.advanceOffsets || []).slice();
		if (rows.length > 1) rows.push(sumRow(rows, ['amount'], {refNbr: '∑', bold: true}));
		items.push(
			detailGrid(rows, [
				textCol('refNbr', t.cols.advanceNbr, 140, (r) => r.refNbr),
				moneyCol('amount', t.cols.offset, 130),
				moneyCol('remainingBalance', t.cols.balanceAfter, 130),
			], 'd-adv', '200px')
		);
	}

	function renderBills(bills, txText) {
		const rows = bills.map((x) => ({id: x.id, doc: txText(x.id), memo: x.memo || '', amount: x.amount}));
		items.push(
			detailGrid(rows, [
				{name: 'doc', label: t.cols.document, width: 220, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.doc} type={Button.Type.LINK} action={() => window.open(`/app/accounting/transactions/vendbill.nl?id=${encodeURIComponent(r.id)}`, '_blank')} />)},
				textCol('memo', t.cols.memo, 360, (r) => r.memo),
				moneyCol('amount', t.cols.amount, 140),
			], 'd-bills', '220px')
		);
	}

	function renderJournalTab() {
		if (!batch.batch.calculated) return items.push(item(<Text type={Text.Type.WEAK}>{t.journalNotReady}</Text>, 'j-none'));
		if (!journal) return items.push(item(actionRow([<Button label={t.actions.journal} enabled={!busy} action={() => pickTab('journal')} />]), 'j-wait'));
		renderJournal();
	}

	function renderJournal() {
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{`${batch.batch.journal ? t.journalTitleReleased : t.journalTitle}: ${journal.memo}`}</Heading>, 'j-title'));
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
					rootStyle={{width: '100%', flexShrink: 0, height: '320px'}}
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
					rootStyle={{width: '100%', flexShrink: 0, height: '520px'}}
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
					rootStyle={{width: '100%', flexShrink: 0, height: '480px'}}
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
						<Button label={t.loadDefaults} hierarchy={boot.setupReady ? Button.Hierarchy.SECONDARY : Button.Hierarchy.PRIMARY} enabled={!busy && boot.user.canEditSetup} action={() =>
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
					<Button label={t.generate} enabled={!busy && boot.user.canEditSetup && boot.setupReady && /^\d{4}$/.test(year) && !!paygroup} action={() =>
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

	// ------------------------------------------------------------------ chấm công và phép
	function renderAttendance() {
		const ta = t.att;
		const periodItems = boot.periods.map((p) => ({value: String(p.id), label: `${p.code} (${p.start} - ${p.end})${p.attStatus === 'L' ? ' 🔒' : ''}`}));
		const per = boot.periods.find((p) => String(p.id) === attPeriod);
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[
						cell(labeled(t.period, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(periodItems)} valueMember="value" displayMember="label" selectedValue={attPeriod} onSelectionChanged={(a) => a.value && a.value !== attPeriod && (setAttPeriod(a.value), loadAttendance(a.value))} />), 'a-per'),
					]}
				</GridPanel>,
				'a-filters'
			)
		);
		const after = (r) => {
			reloadBoot();
			loadAttendance(attPeriod);
			loadDocs(docType);
			return r;
		};
		items.push(
			item(
				actionRow(
					[
						<Button label={ta.build} enabled={!busy && boot.user.canAttendance && !!per && per.attStatus !== 'L'} action={() => run(t.working, post({action: 'buildAttendance', id: attPeriod}), after)} />,
						<Button label={ta.lock} enabled={!busy && boot.user.canAttendance && !!per && per.attStatus !== 'L'} action={() => run(t.working, post({action: 'lockAttendance', id: attPeriod}), after)} />,
						<Button label={ta.unlock} enabled={!busy && boot.user.canAttendance && !!per && per.attStatus === 'L'} action={() => run(t.working, post({action: 'unlockAttendance', id: attPeriod}), after)} />,
					],
					messages
				),
				'a-actions'
			)
		);
		const empName = (id) => {
			const e = employees.find((x) => x.employee === String(id));
			return e ? `${e.code} ${e.name}` : id;
		};
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{ta.summary}</Heading>, 'a-sum-title'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(attRows)}
					columns={[
						textCol('employee', t.employee, 220, (r) => empName(r.employee)),
						textCol('std_days', ta.cols.std, 80, (r) => num(r.std_days)),
						textCol('paid_leave', ta.cols.paid, 90, (r) => num(r.paid_leave)),
						textCol('unpaid_leave', ta.cols.unpaid, 90, (r) => num(r.unpaid_leave)),
						textCol('si_leave', ta.cols.si, 70, (r) => num(r.si_leave)),
						textCol('trip_days', ta.cols.trip, 80, (r) => num(r.trip_days)),
						textCol('late_days', ta.cols.late, 90, (r) => num(r.late_days)),
						textCol('adjust_days', ta.cols.adj, 80, (r) => num(r.adjust_days)),
						textCol('work_days', ta.cols.work, 100, (r) => num(r.work_days)),
						textCol('ot_hours', ta.cols.ot, 70, (r) => num(r.ot_hours)),
						textCol('status', ta.cols.status, 90, (r) => (r.status === 'L' ? '🔒' : '')),
					]}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: '240px'}}
				/>,
				'a-sum'
			)
		);

		// Chứng từ
		const typeItems = Object.keys(ta.types).map((k) => ({value: k, label: ta.types[k]}));
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{ta.docs}</Heading>, 'a-docs-title'));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[cell(labeled(ta.docType, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(typeItems)} valueMember="value" displayMember="label" selectedValue={docType} onSelectionChanged={(a) => a.value && a.value !== docType && (setDocType(a.value), loadDocs(a.value))} />), 'd-type')]}
				</GridPanel>,
				'a-doc-type'
			)
		);
		const docAct = (r, op) => run(t.working, post({action: 'docAction', type: docType, id: r.id, op}), (x) => {
			loadDocs(docType);
			if (x.warnings && x.warnings.length) setNotice(x.warnings.map((w) => (language() === 'vi' ? w.messageVi : w.message)).join('; '));
		});
		const opsFor = (st, locked) => (locked || !boot.user.canAttendance ? [] : st === 'H' ? ['submit'] : st === 'P' ? ['approve', 'reject', 'cancel'] : st === 'A' ? ['cancel'] : []);
		const range = (r) => (docType === 'leave' || docType === 'trip' ? `${r.from || ''} - ${r.to || ''}` : r.work_date || '');
		const qty = (r) => (docType === 'leave' || docType === 'trip' ? `${num(r.days)} ${ta.dayUnit}` : docType === 'ot' ? `${num(r.hours)} h ${r.day_type || ''}` : r.exception_type === 'A' ? num(r.adjust_days) : `${r.minutes || 0}' (-${num(r.deduct_days)})`);
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(docs)}
					columns={[
						{name: 'name', label: t.cols.number, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name} type={Button.Type.LINK} action={() => openRecord(`customrecord_s4vp_${{leave: 'leave_request', ot: 'ot_request', trip: 'business_trip', exception: 'att_exception'}[docType]}`, r.id)} />)},
						textCol('employee', t.employee, 200, (r) => empName(r.employee)),
						textCol('range', t.cols.docDate, 170, range),
						textCol('qty', ta.days, 120, qty),
						textCol('reason', ta.reason, 220, (r) => r.reason || r.purpose || ''),
						textCol('status', ta.cols.status, 100, (r) => ta.reqStatus[r.status] || r.status),
						{name: 'ops', label: '', width: 220, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (
							<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.S}>
								{opsFor(r.status, r.summary_locked).map((op) => <StackPanel.Item key={op}><Button label={ta.ops[op]} type={Button.Type.LINK} action={() => docAct(r, op)} /></StackPanel.Item>).concat([<StackPanel.Item key="none">{plain('')}</StackPanel.Item>])}
							</StackPanel>
						))},
					]}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: '260px'}}
				/>,
				'a-docs'
			)
		);

		// Lập chứng từ mới
		const f = docForm;
		const empItems = employees.map((e) => ({value: e.employee, label: `${e.code} ${e.name}`}));
		const leaveItems = (boot.leaveTypes || []).map((l) => ({value: l.id, label: `${l.code} ${l.name}`}));
		const halfItems = [{value: 'A', label: ta.half.A}, {value: 'P', label: ta.half.P}];
		const exItems = Object.keys(ta.exTypes).map((k) => ({value: k, label: ta.exTypes[k]}));
		const dd = (key, label, list, k) => cell(labeled(label, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(list)} valueMember="value" displayMember="label" selectedValue={f[k] || ''} onSelectionChanged={(a) => a.value && a.value !== f[k] && setDoc(k)(a)} />), key);
		const tb = (key, label, k) => cell(labeled(label, <TextBox rootStyle={{width: '100%'}} text={f[k] || ''} onTextChanged={setDoc(k)} />), key);
		const fields = [dd('f-emp', t.employee, empItems, 'employee')];
		if (docType === 'leave') fields.push(dd('f-lt', ta.leaveType, leaveItems, 'leave_type'), tb('f-from', ta.from, 'from'), dd('f-fh', ta.fromHalf, halfItems, 'from_half'), tb('f-to', ta.to, 'to'), dd('f-th', ta.toHalf, halfItems, 'to_half'), tb('f-reason', ta.reason, 'reason'));
		if (docType === 'ot') fields.push(tb('f-wd', ta.workDate, 'work_date'), tb('f-h', ta.hours, 'hours'), tb('f-reason', ta.reason, 'reason'));
		if (docType === 'trip') fields.push(tb('f-from', ta.from, 'from'), tb('f-to', ta.to, 'to'), tb('f-dest', ta.destination, 'destination'), tb('f-purpose', ta.reason, 'purpose'), tb('f-adv', ta.advanceAmount, 'advance_amount'));
		if (docType === 'exception') fields.push(tb('f-wd', ta.workDate, 'work_date'), dd('f-ext', ta.exceptionType, exItems, 'exception_type'), tb('f-min', ta.minutes, 'minutes'), tb('f-adj', ta.adjust, 'adjust_days'), tb('f-reason', ta.reason, 'reason'));
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{`${ta.newDoc}: ${ta.types[docType]}`}</Heading>, 'a-new-title'));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(200px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{fields}
				</GridPanel>,
				'a-new-form'
			)
		);
		const n = (v) => (v === undefined || String(v).trim() === '' ? null : Number(String(v).replace(',', '.')));
		items.push(
			item(
				actionRow([
					<Button label={ta.save} enabled={!busy && boot.user.canAttendance && !!f.employee} action={() => {
						const v = Object.assign({subsidiary}, docRef.current);
						['hours', 'minutes', 'adjust_days', 'advance_amount'].forEach((k) => v[k] !== undefined && (v[k] = n(v[k])));
						return run(t.working, post({action: 'saveDoc', type: docType, values: v}), (x) => {
							docRef.current = {};
							setDocForm({});
							loadDocs(docType);
							if (x.warnings && x.warnings.length) setNotice(x.warnings.map((w) => (language() === 'vi' ? w.messageVi : w.message)).join('; '));
						});
					}} />,
				]),
				'a-new-save'
			)
		);

		// Chấm công máy (VP310000, VP502000)
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{ta.punches}</Heading>, 'a-p-title'));
		items.push(item(<Text size={Text.Size.S} type={Text.Type.WEAK} rootStyle={{whiteSpace: 'normal'}}>{ta.punchHint}</Text>, 'a-p-hint'));
		items.push(item(<TextArea rootStyle={{width: '100%', maxWidth: '720px', flexShrink: 0}} text={docForm.__punches || ''} onTextChanged={setDoc('__punches')} />, 'a-p-text'));
		items.push(
			item(
				actionRow([
					<Button label={ta.importPunches} enabled={!busy && boot.user.canAttendance} action={() => {
						const rows = String(docRef.current.__punches || '').split(/\r?\n/).map((l) => l.split(',').map((x) => x.trim())).filter((x) => x[0] && x[1]).map((x) => ({employee: x[0], time: x[1], device: x[2] || ''}));
						const chunks = [];
						for (let i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
						const total = {created: 0, skipped: 0, errors: []};
						const sendAll = chunks.reduce((p, c) => p.then(() => post({action: 'importPunches', rows: c, source: 'I'}).then((r) => {
							total.created += r.created || 0;
							total.skipped += r.skipped || 0;
							total.errors = total.errors.concat(r.errors || []);
						})), Promise.resolve());
						return run(t.working, sendAll, () => setNotice(ta.punchResult(total)));
					}} />,
					<Button label={ta.processPunches} enabled={!busy && boot.user.canAttendance && !!per && per.attStatus !== 'L'} action={() => run(t.working, post({action: 'processPunches', id: attPeriod}), (r) => {
						setNotice(ta.processResult(r));
						loadDocs(docType);
					})} />,
				]),
				'a-p-actions'
			)
		);

		// Phép năm
		items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{ta.balances}</Heading>, 'a-bal-title'));
		items.push(
			item(
				actionRow([
					<Button label={`${ta.accrue} ${year}`} enabled={!busy && boot.user.canAttendance && /^\d{4}$/.test(year)} action={() => run(t.working, post({action: 'accrueLeave', year: Number(year), subsidiary, runDate: localToday()}), (r) => {
						setNotice(ta.accrued(r.rows || []));
						return run(t.loading, call({action: 'leaveBalances', subsidiary, year}), (x) => setBalances(x.balances));
					})} />,
					<Button label={`${ta.balances} ${year}`} enabled={!busy} action={() => run(t.loading, call({action: 'leaveBalances', subsidiary, year}), (x) => setBalances(x.balances))} />,
				]),
				'a-bal-actions'
			)
		);
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(balances)}
					columns={[
						textCol('employee', t.employee, 220, (r) => empName(r.employee)),
						textCol('leaveTypeCode', ta.leaveType, 80, (r) => r.leaveTypeCode || ''),
						textCol('entitled', ta.cols.entitled, 80, (r) => num(r.entitled)),
						textCol('carried', ta.cols.carried, 80, (r) => num(r.carried)),
						textCol('adjusted', ta.cols.adjusted, 80, (r) => num(r.adjusted)),
						textCol('used', ta.cols.used, 80, (r) => num(r.used)),
						textCol('pending', ta.cols.pending, 80, (r) => num(r.pending)),
						textCol('available', ta.cols.available, 80, (r) => num(r.available)),
					]}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: '220px'}}
				/>,
				'a-bal'
			)
		);
	}

	// ------------------------------------------------------------------ báo cáo, tờ khai
	function renderReports() {
		const tr = t.rep;
		const lang = language();
		const f = repForm;
		const typeItems = Object.keys(tr.types).map((k) => ({value: k, label: tr.types[k]}));
		const months = [...new Set(boot.periods.map((p) => p.taxMonth).filter(Boolean))].sort().reverse().map((m) => ({value: m, label: `${m.slice(4, 6)}/${m.slice(0, 4)}`}));
		const yn = [{value: 'F', label: tr.yesNo.F}, {value: 'T', label: tr.yesNo.T}];
		const dd = (key, label, list, k) => cell(labeled(label, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(list)} valueMember="value" displayMember="label" selectedValue={f[k] || ''} onSelectionChanged={(a) => a.value !== undefined && a.value !== f[k] && setRep(k)(a)} />), key);
		const tb = (key, label, k) => cell(labeled(label, <TextBox rootStyle={{width: '100%'}} text={f[k] || ''} onTextChanged={setRep(k)} />), key);
		const fields = [cell(labeled(tr.type, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(typeItems)} valueMember="value" displayMember="label" selectedValue={repType} onSelectionChanged={(a) => a.value && a.value !== repType && (setRepType(a.value), setReport(null))} />), 'r-type')];
		if (repType === 'insurance' || repType === 'cost') fields.push(dd('r-month', tr.taxMonth, months, 'taxMonth'));
		if (repType === 'insurance') fields.push(tb('r-c12', tr.c12, 'c12'));
		if (repType === 'pitq' || repType === 'pita') fields.push(tb('r-year', tr.year, 'year'));
		if (repType === 'pitq') fields.push(dd('r-q', tr.quarter, ['1', '2', '3', '4'].map((q) => ({value: q, label: `Q${q}`})), 'quarter'));
		if (repType === 'pita') fields.push(dd('r-s', tr.schedule, [{value: '', label: '05-1/BK + 05-2/BK'}, {value: '05-1', label: '05-1/BK'}, {value: '05-2', label: '05-2/BK'}], 'schedule'));
		fields.push(dd('r-rel', tr.releasedOnly, yn, 'releasedOnly'));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{fields}
				</GridPanel>,
				'r-form'
			)
		);
		const params = () => {
			const v = repRef.current;
			const p = {action: 'report', type: repType, subsidiary, releasedOnly: v.releasedOnly || 'F'};
			if (repType === 'insurance' || repType === 'cost') p.taxMonth = v.taxMonth || (months[0] && months[0].value) || '';
			if (repType === 'insurance' && v.c12) p.c12 = v.c12;
			if (repType === 'pitq' || repType === 'pita') p.year = v.year;
			if (repType === 'pitq') p.quarter = v.quarter;
			if (repType === 'pita') p.schedule = v.schedule || '';
			return p;
		};
		const toCsv = (table) => {
			const esc = (x) => `"${String(x === null || x === undefined ? '' : x).replace(/"/g, '""')}"`;
			const head = table.columns.map((c) => esc(c[lang] || c.vi)).join(',');
			const body = table.rows.map((r) => table.columns.map((c) => esc(r[c.key])).join(','));
			return '﻿' + [head].concat(body).join('\r\n');
		};
		const buttons = [<Button label={tr.run} hierarchy={Button.Hierarchy.PRIMARY} enabled={!busy && !!subsidiary} action={() => run(t.loading, call(params()), (r) => setReport(r))} />];
		if (report) buttons.push(<Button label={tr.csv} action={() => download(`${repType}_${params().taxMonth || params().year || ''}.csv`, toCsv(report))} />);
		if (report && report.d02) buttons.push(<Button label={`${tr.csv} D02-LT`} action={() => download(`D02-LT_${params().taxMonth}.csv`, toCsv(report.d02))} />);
		const extra = messages.slice();
		for (const w of (report && report.warnings) || []) extra.push({text: lang === 'vi' ? w.vi : w.en, strong: true});
		if (report && report.c12Amount !== null && report.c12Amount !== undefined) extra.push({text: tr.c12Diff(report.c12Amount, report.c12Difference)});
		items.push(item(actionRow(buttons, extra), 'r-actions'));
		if (!report) return;
		const grid = (table, key, height) => {
			const cols = table.columns.map((c) => (c.type === 'money' ? moneyCol(c.key, c[lang] || c.vi, 120) : textCol(c.key, c[lang] || c.vi, c.key.toLowerCase().includes('name') ? 200 : 110, (r) => (r[c.key] === null || r[c.key] === undefined ? '' : typeof r[c.key] === 'number' ? num(r[c.key]) : String(r[c.key])))));
			const rows = table.totals ? table.rows.concat([Object.assign({bold: true}, table.totals, {[table.columns[0].key]: '∑'})]) : table.rows;
			return item(<DataGrid dataSource={new ArrayDataSource(rows)} columns={cols} columnStretch={true} placeholder={t.empty} rootStyle={{width: '100%', flexShrink: 0, height: height || '420px'}} />, key);
		};
		if (report.indicators) {
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{tr.indicators}</Heading>, 'r-ind-title'));
			items.push(
				item(
					<DataGrid
						dataSource={new ArrayDataSource(report.indicators)}
						columns={[textCol('code', tr.code, 70, (r) => r.code), textCol('vi', tr.item, 420, (r) => r[lang] || r.vi), textCol('value', tr.value, 160, (r) => (Number(r.value) >= 1000 ? money(r.value) : num(r.value)))]}
						columnStretch={true}
						rootStyle={{width: '100%', flexShrink: 0, height: '420px'}}
					/>,
					'r-ind'
				)
			);
		}
		items.push(grid(report, 'r-grid'));
		if (report.d02) {
			items.push(item(<Heading type={Heading.Type.SMALL_HEADING}>{tr.d02}</Heading>, 'r-d02-title'));
			items.push(grid(report.d02, 'r-d02', '240px'));
		}
	}

	// ------------------------------------------------------------------ sản lượng, khoán tổ
	function renderOutputs() {
		const to = t.out;
		const empName = (id) => {
			const e = employees.find((x) => x.employee === String(id));
			return e ? `${e.code} ${e.name}` : id;
		};
		const periodItems = [{value: '', label: t.allPeriods}].concat(boot.periods.map((p) => ({value: String(p.id), label: `${p.code} (${p.start} - ${p.end})`})));
		const reload = (per) => run(t.loading, call({action: 'outputs', subsidiary, period: per === undefined ? outPeriod : per}), (r) => setOutputs(r.outputs));
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[cell(labeled(t.period, <Dropdown rootStyle={{width: '100%'}} dataSource={new ArrayDataSource(periodItems)} valueMember="value" displayMember="label" selectedValue={outPeriod} onSelectionChanged={(a) => a.value !== undefined && a.value !== outPeriod && (setOutPeriod(a.value), reload(a.value))} />), 'o-per')]}
				</GridPanel>,
				'o-filters'
			)
		);
		items.push(item(actionRow([<Button label={t.actions.refresh} action={() => reload()} />], messages.concat([{text: to.hint}])), 'o-actions'));
		const op = (r, action) => run(t.working, post(action === 'split' ? {action: 'splitOutput', id: r.id} : action === 'members' ? {action: 'loadTeamMembers', id: r.id} : {action: 'outputAction', id: r.id, op: action}), () => reload());
		const opsFor = (r) => (r.status === 'H' ? (r.type === 'T' ? ['members', 'split', 'submit'] : ['submit']) : r.status === 'P' ? ['approve', 'hold'] : r.status === 'A' ? ['hold'] : []);
		const rows = outputs.map((r) => Object.assign({}, r, {
			detailText: r.type === 'T'
				? (r.members || []).map((m) => `${empName(m.employee)}: ${money(m.amount)}`).join('; ')
				: (r.lines || []).map((l) => `${empName(l.employee)} ${l.item} ${num(l.qty)} x ${num(l.rate)} = ${money(l.amount)}`).join('; '),
		}));
		const filtered = quickFilter(rows, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={[
						{name: 'name', label: t.cols.number, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name} type={Button.Type.LINK} action={() => openRecord('customrecord_s4vp_output', r.id)} />)},
						textCol('doc_date', to.cols.date, 100, (r) => r.doc_date),
						textCol('type', to.cols.type, 70, (r) => to.type[r.type] || r.type),
						textCol('description', t.description, 220, (r) => r.description || ''),
						moneyCol('total', to.cols.total, 120),
						moneyCol('split_total', to.cols.split, 120),
						textCol('detailText', to.cols.members, 360, (r) => r.detailText),
						textCol('status', t.cols.status, 110, (r) => to.status[r.status] || r.status),
						{name: 'ops', label: '', width: 260, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (
							<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.S}>
								{opsFor(r).map((a) => <StackPanel.Item key={a}><Button label={to.ops[a]} type={Button.Type.LINK} action={() => op(r, a)} /></StackPanel.Item>).concat([<StackPanel.Item key="none">{plain('')}</StackPanel.Item>])}
							</StackPanel>
						))},
					]}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: '460px'}}
				/>,
				'o-grid'
			)
		);
	}

	// ------------------------------------------------------------------ giấy phép lao động
	function renderPermits() {
		const tw = t.wp;
		const empName = (id) => {
			const e = employees.find((x) => x.employee === String(id));
			return e ? `${e.code} ${e.name}` : id;
		};
		const reload = () => run(t.loading, call({action: 'workPermits', subsidiary}), (r) => setPermits(r.permits));
		const setWp = (k) => (a) => {
			wpRef.current = Object.assign({}, wpRef.current, {[k]: String(a.text || '')});
			setWpForm(wpRef.current);
		};
		items.push(
			item(
				<GridPanel rootStyle={{flexShrink: 0}} columns="repeat(auto-fill, minmax(230px, 1fr))" columnGap={GridPanel.GapSize.M} rowGap={GridPanel.GapSize.S}>
					{[
						cell(labeled(tw.permitNo, <TextBox rootStyle={{width: '100%'}} text={wpForm.permitNo} onTextChanged={setWp('permitNo')} />), 'w-no'),
						cell(labeled(tw.issued, <TextBox rootStyle={{width: '100%'}} text={wpForm.issued} onTextChanged={setWp('issued')} />), 'w-iss'),
					]}
				</GridPanel>,
				'w-form'
			)
		);
		items.push(item(actionRow([<Button label={t.actions.refresh} action={reload} />, <Button label={tw.updateExpired} action={() => run(t.working, post({action: 'updateExpiredPermits'}), reload)} />], messages), 'w-actions'));
		const op = (r, a) => run(t.working, post({action: 'workPermitAction', id: r.id, op: a, permitNo: wpRef.current.permitNo, issued: wpRef.current.issued}), reload);
		const opsFor = (r) => (r.status === 'D' ? ['submit', 'issue'] : r.status === 'S' ? ['issue'] : r.status === 'A' ? ['extend', 'revoke'] : r.status === 'E' ? ['extend'] : []);
		const filtered = quickFilter(permits, quick);
		items.push(item(quickBox(filtered.count), 'quick'));
		items.push(
			item(
				<DataGrid
					dataSource={new ArrayDataSource(filtered.rows)}
					columns={[
						{name: 'name', label: t.cols.number, width: 100, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => <Button label={r.name || r.id} type={Button.Type.LINK} action={() => openRecord('customrecord_s4vp_work_permit', r.id)} />)},
						textCol('employee', t.employee, 220, (r) => empName(r.employee)),
						textCol('permit_no', tw.cols.no, 140, (r) => r.permit_no || ''),
						textCol('issue_type', tw.cols.issue, 90, (r) => tw.issueType[r.issue_type] || r.issue_type || ''),
						textCol('effective', tw.cols.effective, 100, (r) => r.effective || ''),
						textCol('expiry', tw.cols.expiry, 100, (r) => r.expiry || ''),
						textCol('daysLeft', tw.cols.left, 80, (r) => (r.daysLeft === null || r.daysLeft === undefined ? '' : String(r.daysLeft))),
						textCol('status', t.cols.status, 110, (r) => tw.status[r.status] || r.status),
						{name: 'ops', label: '', width: 220, type: DataGrid.ColumnType.TEMPLATED, content: safe((r) => (
							<StackPanel orientation={StackPanel.Orientation.HORIZONTAL} itemGap={StackPanel.GapSize.S}>
								{opsFor(r).map((a) => <StackPanel.Item key={a}><Button label={tw.ops[a]} type={Button.Type.LINK} action={() => op(r, a)} /></StackPanel.Item>).concat([<StackPanel.Item key="none">{plain('')}</StackPanel.Item>])}
							</StackPanel>
						))},
					]}
					columnStretch={true}
					placeholder={t.empty}
					rootStyle={{width: '100%', flexShrink: 0, height: '420px'}}
				/>,
				'w-grid'
			)
		);
	}
}
