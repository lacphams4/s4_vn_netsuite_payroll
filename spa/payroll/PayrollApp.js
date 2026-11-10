/**
 * Khung màn hình "Lương VN" (S4 VN Payroll) bản 2 - docs/UI_V2.md. Khung chỉ lo phần chung: nạp bootstrap, chọn công ty con,
 * hàng tab điều hướng, định tuyến theo hash (#/view?k=v), dải thông báo, hộp xác nhận, dòng "đang xử lý" và cảnh báo
 * tham số pháp lý chưa đối chiếu. Mỗi màn là một view trong views/, nhận đối tượng `app` do khung cấp.
 * Các màn chưa làm lại (hồ sơ, tạm ứng, báo cáo, thiết lập, sản lượng, giấy phép, bảng lương và chấm công bản cũ) chạy
 * trong views/legacy.js bằng thành phần UIF như trước.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, errorText, prefetch} from './lib/api.js';
import {language, pick} from './lib/i18n.js';
import {ensureCss} from './ui/css.js';
import {Button, Menu, Select, Dialog} from './ui/kit.js';
import HomeView from './views/home.js';
import AttendanceView from './views/attendance.js';
import PayrollListView from './views/payrollList.js';
import LaborAnalyticsView from './views/laborAnalytics.js';
import EmployeesView from './views/employees.js';
import ReportsHubView from './views/reportsHub.js';
import AdvancesView from './views/advancesV2.js';
import SetupHubView from './views/setupHub.js';
import PayrollRunView from './views/payrollRun.js';
import CheckDetailView from './views/checkDetail.js';
import LegacyView from './views/legacy.js';

const TEXT = {
	vi: {
		title: 'Lương VN',
		nav: 'Phân hệ',
		tabs: {home: 'Trang chủ', attendance: 'Chấm công', payroll: 'Chạy lương', profiles: 'Nhân sự', advances: 'Tạm ứng', analytics: 'Phân tích chi phí', reports: 'Báo cáo - tờ khai', setup: 'Thiết lập'},
		more: 'Khác',
		outputs: 'Sản lượng - khoán tổ',
		permits: 'Giấy phép lao động',
		subsidiary: 'Công ty con',
		loading: 'Đang tải...',
		working: 'Đang xử lý...',
		failed: 'Lỗi',
		retry: 'Tải lại',
		dismiss: 'Đóng thông báo',
		confirmTitle: 'Xác nhận',
		yes: 'Đồng ý',
		cancel: 'Hủy',
		unverifiedShort: (n) => `${n} tham số pháp lý chưa đối chiếu văn bản gốc, cần kế toán trưởng duyệt (xem Thiết lập)`,
		openSetup: 'Mở Thiết lập',
	},
	en: {
		title: 'VN Payroll',
		nav: 'Module',
		tabs: {home: 'Home', attendance: 'Attendance', payroll: 'Run payroll', profiles: 'Employees', advances: 'Advances', analytics: 'Cost analysis', reports: 'Reports - declarations', setup: 'Setup'},
		more: 'More',
		outputs: 'Output - team piecework',
		permits: 'Work permits',
		subsidiary: 'Subsidiary',
		loading: 'Loading...',
		working: 'Working...',
		failed: 'Error',
		retry: 'Reload',
		dismiss: 'Dismiss',
		confirmTitle: 'Confirm',
		yes: 'OK',
		cancel: 'Cancel',
		unverifiedShort: (n) => `${n} statutory parameters not yet verified against the source documents, chief accountant approval needed (see Setup)`,
		openSetup: 'Open Setup',
	},
};

// View mới (HTML thuần) và view cũ (UIF, trong legacy.js). Tên view cũng là phần đầu của hash.
const VIEWS = {home: HomeView, attendance: AttendanceView, payrollList: PayrollListView, payrollRun: PayrollRunView, checkDetail: CheckDetailView, laborAnalytics: LaborAnalyticsView, employees: EmployeesView, employee: EmployeesView, reportsHub: ReportsHubView, advancesV2: AdvancesView, setupHub: SetupHubView};
const LEGACY = ['batches', 'attendanceLegacy', 'outputs', 'permits', 'reports', 'profiles', 'advances', 'setup'];
// Tab đang sáng theo view
const TAB_OF = {
	home: 'home', attendance: 'attendance', attendanceLegacy: 'attendance', payrollList: 'payroll', payrollRun: 'payroll', checkDetail: 'payroll', batches: 'payroll',
	profiles: 'profiles', employees: 'profiles', employee: 'profiles', advances: 'advances', advancesV2: 'advances', laborAnalytics: 'analytics', reports: 'reports', reportsHub: 'reports', setup: 'setup', setupHub: 'setup', outputs: 'more', permits: 'more',
};
// View mở khi bấm tab
const VIEW_OF_TAB = {home: 'home', attendance: 'attendance', payroll: 'payrollList', profiles: 'profiles', advances: 'advances', analytics: 'laborAnalytics', reports: 'reports', setup: 'setup'};
const DEFAULT_VIEW = 'home';
const known = (view) => !!VIEWS[view] || LEGACY.indexOf(view) >= 0;

// Hash dạng #/view?k=v; hash lạ (hoặc trống) về Trang chủ
function parseHash(hash) {
	try {
		const raw = String(hash || '').replace(/^#\/?/, '');
		const cut = raw.indexOf('?');
		const view = decodeURIComponent(cut >= 0 ? raw.slice(0, cut) : raw);
		const params = {};
		if (cut >= 0) {
			raw.slice(cut + 1).split('&').forEach((pair) => {
				if (!pair) return;
				const eq = pair.indexOf('=');
				const k = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
				if (k) params[k] = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' ')) : '';
			});
		}
		return {view: known(view) ? view : DEFAULT_VIEW, params};
	} catch (e) {
		return {view: DEFAULT_VIEW, params: {}};
	}
}

function buildHash(view, params) {
	const query = Object.keys(params || {})
		.sort()
		.filter((k) => params[k] !== null && params[k] !== undefined && params[k] !== '')
		.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
		.join('&');
	return `#/${encodeURIComponent(view)}${query ? `?${query}` : ''}`;
}

const cleanParams = (params) => {
	const out = {};
	Object.keys(params || {}).forEach((k) => {
		if (params[k] !== null && params[k] !== undefined && params[k] !== '') out[k] = String(params[k]);
	});
	return out;
};

// Chặn vòng lặp vẽ (setState trong lúc vẽ): quá 60 lần vẽ trong 2 giây thì dừng hẳn thay vì treo trình duyệt
let renders = 0;
let windowStart = Date.now();

export default function PayrollApp() {
	if (Date.now() - windowStart > 2000) {
		windowStart = Date.now();
		renders = 0;
	}
	renders += 1;
	if (renders > 60) throw new Error('S4VP payroll: render loop detected');
	ensureCss();

	const t = useRef(pick(TEXT)).current;
	const lang = useRef(language()).current;
	const [boot, setBoot] = useState(null);
	const [bootError, setBootError] = useState('');
	const [subsidiary, setSubsidiary] = useState('');
	const [route, setRoute] = useState(null);
	const [busy, setBusy] = useState('');
	const [notice, setNoticeState] = useState(null);
	const [confirm, setConfirm] = useState(null);
	// Bản mới nhất của route và số thao tác đang chạy, đọc được từ các hàm gọi lại (không phụ thuộc lần vẽ)
	const routeRef = useRef(null);
	const pending = useRef(0);
	const alive = useRef(true);
	const noticeRef = useRef(null);
	const setNotice = (n) => {
		noticeRef.current = n;
		setNoticeState(n);
	};
	if (!routeRef.current) routeRef.current = parseHash(typeof window !== 'undefined' ? window.location.hash : '');
	const current = route && route.view ? route : routeRef.current;

	const sameRoute = (a, b) => !!a && !!b && buildHash(a.view, a.params) === buildHash(b.view, b.params);

	// Đổi màn: cập nhật state ngay (không chờ hashchange) rồi ghi hash; thông báo cũ được xóa khi sang màn khác
	const go = (view, params) => {
		const next = {view: known(view) ? view : DEFAULT_VIEW, params: cleanParams(params)};
		if (sameRoute(next, routeRef.current)) return;
		routeRef.current = next;
		setNotice(null);
		setRoute(next);
		try {
			const hash = buildHash(next.view, next.params);
			if (window.location.hash !== hash) window.location.hash = hash;
		} catch (e) {
			// không ghi được hash: vẫn chuyển màn bằng state
		}
	};

	const notify = (text, kind) => {
		if (!alive.current) return;
		setNotice(text ? {text: String(text), kind: kind === 'warn' || kind === 'error' ? kind : 'ok'} : null);
	};

	// Chạy một thao tác: hiện "đang xử lý", bắt lỗi và báo lỗi; trả promise kết quả (undefined nếu lỗi)
	const run = (label, work) => {
		let promise;
		try {
			promise = typeof work === 'function' ? work() : work;
		} catch (e) {
			promise = Promise.reject(e);
		}
		pending.current += 1;
		setBusy(label || t.working);
		// Lỗi của thao tác trước không còn đúng nữa; thông báo thành công giữ lại đến khi sang màn khác hoặc người dùng đóng
		if (noticeRef.current && noticeRef.current.kind === 'error') setNotice(null);
		const finish = () => {
			pending.current = Math.max(0, pending.current - 1);
			if (!pending.current && alive.current) setBusy('');
		};
		return Promise.resolve(promise).then(
			(r) => {
				finish();
				return r;
			},
			(e) => {
				finish();
				notify(`${t.failed}: ${errorText(e)}`, 'error');
				return undefined;
			}
		);
	};

	// fresh: bỏ bản bootstrap máy chủ đang nhớ (sau khi đổi thiết lập, sinh kỳ, khóa công); lần mở đầu dùng bản nhớ cho nhanh
	const reloadBoot = (fresh) => {
		setBootError('');
		pending.current += 1;
		setBusy(t.loading);
		return call(fresh ? {action: 'bootstrap', fresh: '1'} : {action: 'bootstrap'}).then(
			(b) => {
				pending.current = Math.max(0, pending.current - 1);
				if (!alive.current) return undefined;
				if (!pending.current) setBusy('');
				const data = b || {};
				setBoot(data);
				return data;
			},
			(e) => {
				pending.current = Math.max(0, pending.current - 1);
				if (!alive.current) return undefined;
				if (!pending.current) setBusy('');
				setBootError(`${t.failed}: ${errorText(e)}`);
				return undefined;
			}
		);
	};

	useEffect(() => {
		alive.current = true;
		// Màn mở thẳng bằng địa chỉ có id (bảng lương): đọc dữ liệu màn song song với bootstrap
		try {
			const first = routeRef.current;
			if (first && first.view === 'payrollRun' && first.params && first.params.id) prefetch({action: 'runView', id: String(first.params.id)});
		} catch (e) {
			// bỏ qua: view tự nạp
		}
		reloadBoot(false).then((b) => {
			if (!b || !alive.current) return;
			const subs = b.subsidiaries || [];
			if (subs.length) setSubsidiary(String((subs.find((s) => s.enabled) || subs[0]).id));
			// Chưa có thiết lập lương: vào thẳng Thiết lập
			if (!b.setupReady) go('setup');
		});
		const onHash = () => {
			const next = parseHash(window.location.hash);
			if (sameRoute(next, routeRef.current)) return;
			routeRef.current = next;
			setNotice(null);
			setRoute(next);
		};
		window.addEventListener('hashchange', onHash);
		return () => {
			alive.current = false;
			window.removeEventListener('hashchange', onHash);
		};
	}, []);

	const app = {
		boot,
		subsidiary,
		route: current,
		go,
		run,
		notify,
		confirm: (text, onYes) => setConfirm({text: String(text || ''), onYes}),
		busy,
		lang,
		reloadBoot: () => reloadBoot(true),
	};

	const activeTab = TAB_OF[current.view] || '';
	const tabs = Object.keys(VIEW_OF_TAB).map((k) => {
		const attrs = {type: 'button', class: `s4vp-navtab${activeTab === k ? ' s4vp-on' : ''}`, onClick: () => go(VIEW_OF_TAB[k])};
		if (activeTab === k) attrs['aria-current'] = 'page';
		return (
			<button key={k} {...attrs}>
				{t.tabs[k]}
			</button>
		);
	});
	const subs = boot && Array.isArray(boot.subsidiaries) ? boot.subsidiaries : [];
	const unverified = boot && Array.isArray(boot.unverified) ? boot.unverified.length : 0;

	let content = null;
	if (boot) {
		if (VIEWS[current.view]) {
			const View = VIEWS[current.view];
			content = <View key={current.view} app={app} />;
		} else {
			content = <LegacyView key="legacy" app={app} view={current.view} />;
		}
	}

	return (
		<div class="s4vp-app">
			<nav class="s4vp-nav" aria-label={t.nav}>
				<div class="s4vp-brand">{t.title}</div>
				{tabs}
				<Menu key="more" kind="tab" active={activeTab === 'more'} label={t.more} items={[{label: t.outputs, onClick: () => go('outputs')}, {label: t.permits, onClick: () => go('permits')}]} />
				<div class="s4vp-navright">
					{busy ? (
						<span class="s4vp-busy" role="status" aria-live="polite">
							<span class="s4vp-spin" />
							<span>{busy}</span>
						</span>
					) : null}
					{subs.length ? <span class="s4vp-lbl">{t.subsidiary}</span> : null}
					{subs.length ? <Select key="sub" value={subsidiary} ariaLabel={t.subsidiary} width={240} options={subs.map((s) => ({value: String(s.id), label: s.name}))} onInput={(v) => v && v !== subsidiary && setSubsidiary(v)} /> : null}
				</div>
			</nav>
			{/* Chỉ nhắc ở Trang chủ (Thiết lập tự hiện phần riêng): các màn làm việc dành chiều cao cho nội dung */}
			{boot && unverified && current.view === 'home' ? (
				<div class="s4vp-strip s4vp-strip-warn" role="status">
					<span class="s4vp-strip-text">{t.unverifiedShort(unverified)}</span>
					<Button kind="link" label={t.openSetup} onClick={() => go('setup')} />
				</div>
			) : null}
			{bootError ? (
				<div class="s4vp-strip s4vp-strip-error" role="alert">
					<span class="s4vp-strip-text">{bootError}</span>
					<Button label={t.retry} onClick={() => reloadBoot(true)} />
				</div>
			) : null}
			{notice ? (
				<div class={`s4vp-strip s4vp-strip-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
					<span class="s4vp-strip-text">{notice.text}</span>
					<button type="button" class="s4vp-x" aria-label={t.dismiss} title={t.dismiss} onClick={() => setNotice(null)}>{'×'}</button>
				</div>
			) : null}
			{content}
			{confirm ? (
				<Dialog
					key="confirm"
					title={t.confirmTitle}
					onClose={() => setConfirm(null)}
					width={460}
					actions={[
						<Button label={t.cancel} onClick={() => setConfirm(null)} />,
						<Button
							kind="primary"
							label={t.yes}
							onClick={() => {
								const c = confirm;
								setConfirm(null);
								if (c && c.onYes) c.onYes();
							}}
						/>,
					]}
				>
					<div style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{confirm.text}</div>
				</Dialog>
			) : null}
		</div>
	);
}
