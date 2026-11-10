/**
 * Thanh các bước của giao diện bản 2 (docs/UI_V2.md): suy ra trạng thái từng bước của quy trình chạy lương (6 bước) và
 * tính công (4 bước) từ dữ liệu sẵn có, không lưu thêm gì. Giao diện đổi key / note thành chữ.
 *
 * Mỗi bước: { key, state: "done" | "current" | "todo", note?, count? }. Thanh bước là tuyến tính: mọi bước trước bước
 * "current" là "done", mọi bước sau là "todo"; nhiều nhất một bước "current". note là mã ngắn nói thêm về bước (không phải
 * chữ hiển thị), count là số đi kèm note.
 *
 * CHẠY LƯƠNG - payrollSteps(batch, period, counts)
 *   batch: { status, calculated, emp_count }; trạng thái H tạm giữ, B chờ tính, C đã tính, P chờ duyệt, A đã duyệt,
 *   J từ chối, R đã ghi sổ, V đã đảo. period: { att_status } ("L" = công đã khóa). counts: { employees, openChecks }
 *   (employees thiếu thì lấy batch.emp_count; openChecks = số cảnh báo chưa xử lý, thiếu = chưa biết).
 *   1 prepare    xong khi bảng lương có nhân viên. note "employees" + count.
 *   2 attendance xong khi công của kỳ đã khóa (note "locked"). Chưa khóa mà chưa tính lương thì đây là bước hiện tại
 *                (note "open"); đã tính lương khi công chưa khóa thì bước vẫn tính là đã qua nhưng giữ note "open" để
 *                giao diện nhắc (hệ thống cho tính lương theo công chuẩn khi chưa có bảng công).
 *   3 calculate  hiện tại khi trạng thái H / B (hoặc C nhưng cờ calculated chưa bật) và hai bước trước đã xong.
 *                Trạng thái H: bước calculate mang note "hold" (phải bỏ tạm giữ trước khi tính).
 *   4 review     hiện tại khi đã tính (C) mà còn cảnh báo chưa xử lý (note "openChecks" + count) hoặc chưa biết số cảnh
 *                báo; hiện tại khi bị từ chối (J, note "rejected"). Xong khi C và openChecks = 0, hoặc từ P trở đi.
 *   5 approve    hiện tại khi C không còn cảnh báo, hoặc P (note "pending"). Xong từ A trở đi.
 *   6 post       hiện tại khi A (đã duyệt, chờ chi lương và ghi sổ). Xong khi R. V (đã đảo): cả 6 bước xong, bước post
 *                mang note "reversed".
 *   Không có batch (chưa tạo bảng lương): prepare là bước hiện tại, count 0.
 *
 * TÍNH CÔNG - attendanceSteps(period, counts)
 *   period: { att_status }; counts: { openExceptions, hasSummary, hasBatch }.
 *   1 collect    thu dữ liệu công: xong khi đã lập bảng tổng hợp công (hasSummary) hoặc công đã khóa.
 *   2 exceptions xử lý ngoại lệ: hiện tại khi đã có bảng công mà còn ngoại lệ chưa xử lý (note "openExceptions" + count);
 *                xong khi không còn. Công đã khóa mà vẫn còn ngoại lệ: bước tính là đã qua, giữ note để nhắc.
 *   3 lock       khóa công: hiện tại khi hết ngoại lệ mà chưa khóa; xong khi att_status = "L" (note "locked").
 *   4 handoff    chuyển sang chạy lương: hiện tại khi công đã khóa mà kỳ chưa có bảng lương; xong khi đã có (hasBatch).
 *
 * progress(steps) -> { done, total, currentKey }: số bước đã xong, tổng số bước, key bước hiện tại (null nếu xong hết).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
	const PAYROLL_KEYS = ["prepare", "attendance", "calculate", "review", "approve", "post"];
	const ATTENDANCE_KEYS = ["collect", "exceptions", "lock", "handoff"];

	const count = (v) => {
		const n = Number(v);
		return isFinite(n) && n > 0 ? Math.floor(n) : 0;
	};
	const known = (v) => v !== null && v !== undefined && v !== "" && isFinite(Number(v));
	const truthy = (v) => v === true || v === "T" || v === 1 || v === "1" || v === "true";

	/** Dựng dãy bước tuyến tính: chỉ số bước hiện tại (bằng số bước = xong hết) và note theo key. */
	function build(keys, currentIndex, notes) {
		return keys.map((key, i) => {
			const step = { key, state: i < currentIndex ? "done" : i === currentIndex ? "current" : "todo" };
			const extra = notes[key];
			if (extra && extra.note) {
				step.note = extra.note;
				if (extra.count !== undefined) step.count = extra.count;
			}
			return step;
		});
	}

	function payrollSteps(batch, period, counts) {
		const b = batch || {};
		const c = counts || {};
		const status = String(b.status || "").toUpperCase();
		const employees = known(c.employees) ? count(c.employees) : count(b.emp_count);
		const locked = String((period || {}).att_status || "").toUpperCase() === "L";
		const checksKnown = known(c.openChecks);
		const openChecks = count(c.openChecks);
		const calculated = truthy(b.calculated);
		const notes = {};
		notes.prepare = { note: "employees", count: employees };
		notes.attendance = { note: locked ? "locked" : "open" };

		let current;
		if (status === "R" || status === "V") current = PAYROLL_KEYS.length;
		else if (status === "A") current = 5;
		else if (status === "P") current = 4;
		else if (status === "J") current = 3;
		else if (status === "C" && calculated) current = checksKnown && openChecks === 0 ? 4 : 3;
		else if (employees === 0) current = 0;
		else if (!locked) current = 1;
		else current = 2;

		if (status === "H") notes.calculate = { note: "hold" };
		if (current >= 3 && openChecks > 0) notes.review = { note: "openChecks", count: openChecks };
		if (status === "J") notes.review = { note: "rejected", count: openChecks };
		if (status === "P") notes.approve = { note: "pending" };
		if (status === "V") notes.post = { note: "reversed" };
		return build(PAYROLL_KEYS, current, notes);
	}

	function attendanceSteps(period, counts) {
		const c = counts || {};
		const locked = String((period || {}).att_status || "").toUpperCase() === "L";
		const hasSummary = truthy(c.hasSummary) || count(c.hasSummary) > 0;
		const hasBatch = truthy(c.hasBatch) || count(c.hasBatch) > 0;
		const open = count(c.openExceptions);
		const notes = {};
		if (open > 0) notes.exceptions = { note: "openExceptions", count: open };
		if (locked) notes.lock = { note: "locked" };

		let current;
		if (locked) current = hasBatch ? ATTENDANCE_KEYS.length : 3;
		else if (!hasSummary) current = 0;
		else if (open > 0) current = 1;
		else current = 2;
		return build(ATTENDANCE_KEYS, current, notes);
	}

	function progress(steps) {
		const list = Array.isArray(steps) ? steps : [];
		const cur = list.find((s) => s && s.state === "current");
		return { done: list.filter((s) => s && s.state === "done").length, total: list.length, currentKey: cur ? cur.key : null };
	}

	return { PAYROLL_KEYS, ATTENDANCE_KEYS, payrollSteps, attendanceSteps, progress };
});
