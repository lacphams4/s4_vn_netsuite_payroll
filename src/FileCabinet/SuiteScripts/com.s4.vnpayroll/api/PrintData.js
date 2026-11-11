/**
 * Đọc dữ liệu cho các bản in bổ sung của Suitelet in (scripts/s4vp_sl_print.js, mô hình core/PrintModelExtra): bảng chấm
 * công tháng, bảng kê xác nhận thù lao cộng tác viên, bảng chia lương tổ, bảng hoa hồng, phiếu thông tin hợp đồng / quyết
 * định nhân sự. CHỈ ĐỌC. Kiểm tra vai trò nằm ở Suitelet.
 *
 * Mọi hàm đọc theo lô, số truy vấn không phụ thuộc số nhân viên (danh sách id chia khối 900 trong Store.findIn /
 * TimeLines.entries / Payroll.employeesInfo). Không ghi số tiền, số định danh vào log.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Payroll", "./Settings", "./TimeLines", "./AttendanceMonth", "./Clock", "../core/AttendanceMonthGrid"], (Store, Payroll, Settings, TimeLines, AttendanceMonth, Clock, Grid) => {
	const blank = (v) => v === null || v === undefined || v === "";
	const norm = (s) => String(blank(s) ? "" : s).trim().toUpperCase();

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function safe(fn, fallback) {
		try {
			return fn();
		} catch (e) {
			return fallback;
		}
	}

	function intId(v, en, vi) {
		if (!/^\d+$/.test(String(blank(v) ? "" : v))) throw fail(en, vi);
		return String(v);
	}

	/** Tên đầy đủ của các phòng ban theo id; vai trò không đọc được bảng department thì trả rỗng. */
	function departmentNames(ids) {
		const list = [...new Set((ids || []).filter((x) => /^\d+$/.test(String(x))).map(String))];
		const out = {};
		if (!list.length) return out;
		for (const r of safe(() => Store.run(`SELECT d.id AS id, d.fullname AS name FROM department d WHERE d.id IN (${list.join(",")})`, [], "s4vp_print_departments"), [])) out[String(r.id)] = r.name || "";
		return out;
	}

	/**
	 * Bảng chấm công tháng: lưới công của kỳ (api/AttendanceMonth.month, 9 truy vấn không phụ thuộc số nhân viên) đã giải nén.
	 * @param {{period?, batch?, subsidiary?, department?}} p kỳ (hoặc bảng lương để lấy kỳ + công ty con), bộ phận lọc (id)
	 * @returns {{grid, subsidiary, department: string}} department là TÊN bộ phận lọc ("" khi không lọc)
	 */
	function timesheet(p) {
		let period = p.period;
		let subsidiary = blank(p.subsidiary) ? "" : String(p.subsidiary);
		if (blank(period) && !blank(p.batch)) {
			const b = Payroll.getBatch(intId(p.batch, "Invalid payroll batch", "Bảng lương không hợp lệ"));
			period = b.period;
			if (!subsidiary) subsidiary = String(b.subsidiary || "");
		}
		if (blank(period)) throw fail("Select a pay period", "Hãy chọn kỳ lương");
		let department = "";
		if (!blank(p.department)) {
			const id = intId(p.department, "Invalid department", "Bộ phận không hợp lệ");
			department = departmentNames([id])[id] || "";
			if (!department) throw fail("Department not found", "Không tìm thấy bộ phận");
		}
		const month = AttendanceMonth.month({ period: intId(period, "Invalid pay period", "Kỳ lương không hợp lệ"), subsidiary });
		return { grid: { period: month.period, days: month.days, rows: Grid.unpackRows(month), legend: month.legend, symbols: month.symbols }, subsidiary, department };
	}

	/**
	 * Bảng kê thù lao cộng tác viên: bảng lương + dòng Time đã nhận vào lương của các cộng tác viên trong cửa sổ kết công.
	 * Account không bật Time Tracking: entries rỗng, bảng kê vẫn in phần giờ công tính lương và thù lao.
	 */
	function contractorStatement(batchId, employee) {
		const detail = Payroll.detail(intId(batchId, "Invalid payroll batch", "Bảng lương không hợp lệ"));
		const ids = detail.lines.filter((l) => norm(l.employment_type || "E") === "C" && (blank(employee) || String(l.employee) === String(employee))).map((l) => l.employee);
		const period = Store.get("period", detail.batch.period);
		const window = period ? TimeLines.windowOf(period) : { from: detail.batch.periodStart, to: detail.batch.periodEnd };
		const settings = Settings.resolve(detail.batch.subsidiary, null);
		let entries = [];
		let timeUnavailable = false;
		if (ids.length) {
			try {
				entries = TimeLines.accepted(TimeLines.entries(ids, window.from, window.to), settings.requireTimeApproval !== false);
			} catch (e) {
				timeUnavailable = true;
			}
		}
		return { detail, entries, window, settings, timeUnavailable };
	}

	/** Bảng chia lương tổ của một phiếu sản lượng: phiếu, dòng, thành viên, tổ, bảng đơn giá, tên nhân viên. */
	function teamSplit(outputId) {
		const entry = Store.get("output", intId(outputId, "Invalid output entry", "Phiếu sản lượng không hợp lệ"));
		if (!entry) throw fail("Output entry not found", "Không tìm thấy phiếu sản lượng");
		const lines = Store.find("output_line", { where: "{entry} = ?", params: [entry.id] });
		const members = Store.find("output_member", { where: "{entry} = ?", params: [entry.id] });
		const team = blank(entry.team) ? null : Store.get("team", entry.team);
		const table = blank(entry.rate_table) ? null : Store.get("rate_table", entry.rate_table);
		const period = blank(entry.period) ? null : Store.get("period", entry.period);
		const employees = Payroll.employeesInfo(members.map((m) => m.employee).concat(lines.map((l) => l.employee), [team && team.leader, entry.approved_by]));
		const nameOf = (id) => (blank(id) ? "" : (employees[String(id)] || {}).name || "");
		const projectName = blank(entry.project) || !/^\d+$/.test(String(entry.project))
			? ""
			: safe(() => (Store.run(`SELECT COALESCE(j.companyname, j.entityid) AS name FROM job j WHERE j.id = ${entry.project}`, [], "s4vp_print_project")[0] || {}).name || "", "");
		return {
			entry, lines, members, employees, projectName,
			periodName: period ? period.name : "",
			team: team ? { code: norm(team.name), description: team.description || "", leaderName: nameOf(team.leader) } : {},
			rateTable: table ? { code: norm(table.name), description: table.description || "" } : {},
			approvedByName: nameOf(entry.approved_by),
		};
	}

	/** Bảng hoa hồng: bảng lương + nguồn số lượng / nguồn đơn giá của các quy tắc thu nhập (kể cả quy tắc đã vô hiệu). */
	function commission(batchId) {
		const detail = Payroll.detail(intId(batchId, "Invalid payroll batch", "Bảng lương không hợp lệ"));
		const rules = {};
		for (const r of Store.find("earning_rule", { includeInactive: true })) rules[norm(r.name)] = { quantitySource: r.qty_source || "", rateSource: r.rate_source || "" };
		return { detail, rules };
	}

	const employeeView = (e) => ({ code: (e && e.code) || "", name: (e && e.name) || "", departmentName: (e && e.departmentName) || "", subsidiary: e && !blank(e.subsidiary) ? String(e.subsidiary) : "" });

	/** Hợp đồng lao động / phụ lục theo id kèm hợp đồng gốc (của phụ lục) và thông tin nhân viên. */
	function contract(id) {
		const record = Store.get("contract", intId(id, "Invalid contract", "Hợp đồng không hợp lệ"));
		if (!record) throw fail("Contract not found", "Không tìm thấy hợp đồng");
		const parent = blank(record.parent) ? null : Store.get("contract", record.parent);
		return { record, parent, employee: employeeView(Payroll.employeesInfo([record.employee])[String(record.employee)]), today: Clock.today() };
	}

	/** Quyết định nhân sự theo id kèm tên phòng ban cũ / mới, người áp dụng và thông tin nhân viên. */
	function decision(id) {
		const record = Store.get("decision", intId(id, "Invalid decision", "Quyết định không hợp lệ"));
		if (!record) throw fail("Personnel decision not found", "Không tìm thấy quyết định nhân sự");
		const people = Payroll.employeesInfo([record.employee, record.applied_by]);
		return {
			record,
			employee: employeeView(people[String(record.employee)]),
			departments: departmentNames([record.old_department, record.new_department]),
			appliedByName: blank(record.applied_by) ? "" : (people[String(record.applied_by)] || {}).name || "",
			today: Clock.today(),
		};
	}

	return { timesheet, contractorStatement, teamSplit, commission, contract, decision, departmentNames };
});
