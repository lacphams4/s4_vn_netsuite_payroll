/**
 * Tạo dữ liệu test (VP509000): nhân viên giả lập "S4VP TEST" kèm hồ sơ lương theo các ca vàng của đặc tả, hai nhà
 * cung cấp giả lập cơ quan thu. Chỉ Administrator, chỉ dùng trên account test; bản production không deploy file này.
 * Chạy lại an toàn: nhân viên, nhà cung cấp, hồ sơ đã có (theo tên) thì không tạo lại. Không dùng dữ liệu người thật.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/record", "N/runtime", "./Store", "./Profiles"], (record, runtime, Store, Profiles) => {
	const TAG = "S4VP TEST";

	// Ca vàng tháng 10/2026 (kỳ 202610, công chuẩn 22 với nghỉ T7 + CN)
	const PEOPLE = [
		{ first: "NV01 Van phong", note: "TN-01, KB-10: lương 30tr, 1 NPT, tạm ứng 5tr", profile: { employment_type: "E", salary_type: "M", pit_method: "P", region: "I", accrue13: true, bank_name: "Vietcombank", bank_account: "0071000000001" }, comp: { base_salary: 30000000, insurance_wage: 30000000 }, deps: [{ name: "S4VP TEST NPT 01", relationship: "Con", from: "2024-01-01" }] },
		{ first: "NV02 Cong nhan", note: "KB-15: vùng II, lương 10,4tr, OT nhập tay", profile: { employment_type: "E", salary_type: "M", pit_method: "P", region: "II", bank_name: "Vietinbank", bank_account: "1010000000002" }, comp: { base_salary: 10400000, insurance_wage: 10400000 } },
		{ first: "CTV03 Theo gio", note: "FL-05: CTV 80 giờ x 196.000, khấu trừ 10%", profile: { employment_type: "C", salary_type: "H", pit_method: "F", ins_applicable: false, ui_applicable: false, bank_name: "ACB", bank_account: "2020000000003" }, comp: { base_salary: 196000, insurance_wage: 0 } },
		{ first: "NV04 Nuoc ngoai", note: "BH-15: người nước ngoài không BHTN, lương 60tr", profile: { employment_type: "E", salary_type: "M", pit_method: "P", region: "I", ui_applicable: false, foreign: true, nationality: "JP", bank_name: "MUFG", bank_account: "3030000000004" }, comp: { base_salary: 60000000, insurance_wage: 60000000 } },
		{ first: "NV05 Thu viec", note: "HD-01, FL-02: vào làm 15/10/2026, lương thử việc 85% x 15tr, khấu trừ 10%", profile: { employment_type: "E", salary_type: "M", pit_method: "F", ins_applicable: false, ui_applicable: false, hire_date: "2026-10-15", bank_name: "Techcombank", bank_account: "4040000000005" }, comp: { base_salary: 12750000, insurance_wage: 0 } },
	];

	function findEmployee(first, subsidiary) {
		return Store.run("SELECT id FROM employee WHERE lastname = ? AND firstname = ? AND subsidiary = ?", [TAG, first, subsidiary], "s4vp_test_emp")[0];
	}

	function createEmployee(first, subsidiary, note) {
		const r = record.create({ type: record.Type.EMPLOYEE, isDynamic: false });
		r.setValue({ fieldId: "firstname", value: first });
		r.setValue({ fieldId: "lastname", value: TAG });
		r.setValue({ fieldId: "subsidiary", value: subsidiary });
		r.setValue({ fieldId: "comments", value: `${TAG}: ${note}` });
		try {
			return String(r.save({ enableSourcing: true, ignoreMandatoryFields: true }));
		} catch (e) {
			// Account không tự đánh số nhân viên: đặt mã
			r.setValue({ fieldId: "entityid", value: `${TAG} ${first}` });
			return String(r.save({ enableSourcing: true, ignoreMandatoryFields: true }));
		}
	}

	function vendor(name, subsidiary) {
		const hit = Store.run("SELECT id FROM vendor WHERE companyname = ?", [name], "s4vp_test_vendor")[0];
		if (hit) return String(hit.id);
		const r = record.create({ type: record.Type.VENDOR, isDynamic: false });
		r.setValue({ fieldId: "isperson", value: "F" });
		r.setValue({ fieldId: "companyname", value: name });
		r.setValue({ fieldId: "subsidiary", value: subsidiary });
		r.setValue({ fieldId: "comments", value: `${TAG}: agency vendor for payroll testing` });
		try {
			return String(r.save({ enableSourcing: true, ignoreMandatoryFields: true }));
		} catch (e) {
			r.setValue({ fieldId: "entityid", value: name });
			return String(r.save({ enableSourcing: true, ignoreMandatoryFields: true }));
		}
	}

	function generate(subsidiary) {
		if (runtime.getCurrentUser().roleId !== "administrator") throw new Error("Administrator only / Chỉ Administrator");
		const out = { employees: [], vendors: {} };
		out.vendors.insurance = vendor(`${TAG} - Co quan BHXH`, subsidiary);
		out.vendors.tax = vendor(`${TAG} - Co quan thue`, subsidiary);
		out.vendors.union = vendor(`${TAG} - Cong doan`, subsidiary);
		for (const p of PEOPLE) {
			const hit = findEmployee(p.first, subsidiary);
			const id = hit ? String(hit.id) : createEmployee(p.first, subsidiary, p.note);
			const has = Store.find("employee", { where: "{employee} = ?", params: [id], includeInactive: true })[0];
			if (!has) {
				Profiles.save({
					employee: id, subsidiary, name: `${TAG} ${p.first}`, profile: p.profile,
					compensation: Object.assign({ effective: "2026-01-01" }, p.comp),
					dependents: (p.deps || []).map((d) => ({ name: d.name, relationship: d.relationship, from: d.from })),
				});
			}
			out.employees.push({ id, name: p.first, created: !hit, note: p.note });
		}
		return out;
	}

	/**
	 * Giờ Time thử cho CTV theo giờ (FL-05: 80 giờ = 10 ngày làm việc x 8 giờ, đã duyệt) và một dòng 4 giờ để chờ duyệt
	 * (kiểm tra giờ chưa duyệt không vào lương). Chạy lại an toàn: ngày đã có dòng ghi chú S4VP TEST thì bỏ qua.
	 * @returns {{created: number, skipped: number, approvalFailed: number}}
	 */
	function timeEntries(subsidiary, from, to) {
		const emp = findEmployee("CTV03 Theo gio", subsidiary);
		if (!emp) throw new Error("Test employee CTV03 not found; run generateTestData first / Chưa có nhân viên thử CTV03");
		const days = [];
		for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`) && days.length < 11; d.setUTCDate(d.getUTCDate() + 1)) {
			if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
		}
		const existing = new Set(
			Store.run(`SELECT TO_CHAR(t.trandate, 'YYYY-MM-DD') AS c_date FROM timebill t WHERE t.employee = ? AND t.memo LIKE ? AND t.trandate >= TO_DATE(?, 'YYYY-MM-DD') AND t.trandate <= TO_DATE(?, 'YYYY-MM-DD')`, [emp.id, `${TAG}%`, from, to], "s4vp_test_time").map((r) => r.c_date)
		);
		const out = { created: 0, skipped: 0, approvalFailed: 0 };
		days.forEach((day, i) => {
			if (existing.has(day)) {
				out.skipped += 1;
				return;
			}
			const pending = i === 10;
			const r = record.create({ type: record.Type.TIME_BILL, isDynamic: true });
			r.setValue({ fieldId: "employee", value: emp.id });
			r.setValue({ fieldId: "trandate", value: new Date(`${day}T12:00:00Z`) });
			r.setValue({ fieldId: "hours", value: pending ? 4 : 8 });
			r.setValue({ fieldId: "memo", value: `${TAG} gio cong CTV${pending ? " (cho duyet)" : ""}` });
			if (!pending) {
				try {
					r.setValue({ fieldId: "approvalstatus", value: 3 });
				} catch (e) {
					out.approvalFailed += 1;
				}
			}
			r.save({ ignoreMandatoryFields: true });
			out.created += 1;
		});
		return out;
	}

	return { generate, timeEntries, TAG };
});
