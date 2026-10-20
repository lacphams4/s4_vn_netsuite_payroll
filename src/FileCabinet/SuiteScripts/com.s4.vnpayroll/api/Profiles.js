/**
 * Hồ sơ lương nhân viên (VP203000) kèm lịch sử lương và người phụ thuộc; danh mục cho màn hình thiết lập
 * (tài khoản, nhà cung cấp). Dữ liệu lương nhạy cảm: không ghi số tiền, số định danh vào log.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Settings"], (Store, Settings) => {
	const blank = (v) => v === null || v === undefined || v === "";

	/** Nhân viên của subsidiary kèm hồ sơ lương (nếu có) và lịch sử lương mới nhất. */
	function list(subsidiary) {
		const emps = Store.run(
			`SELECT e.id, e.entityid, e.firstname, e.lastname, e.isinactive, BUILTIN.DF(e.department) AS dept, e.hiredate
			 FROM employee e WHERE e.subsidiary = ? ORDER BY e.entityid`,
			[subsidiary],
			"s4vp_profile_emps"
		);
		const profiles = {};
		for (const p of Store.find("employee", { where: "{subsidiary} = ?", params: [subsidiary], includeInactive: true })) profiles[p.employee] = p;
		const comps = {};
		const profIds = Object.values(profiles).map((p) => p.id);
		for (const c of Store.findIn("compensation", "profile", profIds)) if (!comps[c.profile] || c.effective > comps[c.profile].effective) comps[c.profile] = c;
		const deps = {};
		for (const d of Store.findIn("dependent", "profile", profIds)) deps[d.profile] = (deps[d.profile] || 0) + 1;
		return emps.map((e) => {
			const p = profiles[String(e.id)];
			const c = p ? comps[p.id] : null;
			return {
				employee: String(e.id), code: e.entityid, name: [e.lastname, e.firstname].filter(Boolean).join(" ") || e.entityid, inactive: e.isinactive === "T", department: e.dept || "",
				profile: p ? Object.assign({}, p) : null, compensation: c, dependents: p ? deps[p.id] || 0 : 0,
			};
		});
	}

	/**
	 * Tạo / cập nhật hồ sơ lương và (tùy chọn) thêm dòng lịch sử lương, người phụ thuộc.
	 * @param {{employee, subsidiary, profile: object, compensation?: {effective, base_salary, insurance_wage, allowance, package}, dependents?: Array}} input
	 */
	function save(input) {
		if (blank(input.employee) || blank(input.subsidiary)) throw new Error("Employee and subsidiary are required / Thiếu nhân viên hoặc công ty con");
		const existing = Store.find("employee", { where: "{employee} = ?", params: [input.employee], includeInactive: true })[0];
		const values = Object.assign({ employee: input.employee, subsidiary: input.subsidiary }, input.profile || {});
		if (!values.name && !existing) values.name = input.name || String(input.employee);
		// Cam kết 08/CK chỉ giữ khi phương pháp thuế là khấu trừ 10% (2.4.2)
		if (values.pit_method && values.pit_method !== "F") values.flat_commit = false;
		// Không tham gia BH thì tắt BHTN, đoàn viên (2.3.1)
		if (values.ins_applicable === false) {
			values.ui_applicable = false;
			values.union_member = false;
		}
		const id = existing ? (Store.update("employee", existing.id, values), existing.id) : Store.create("employee", values);
		if (input.compensation && input.compensation.effective) {
			const dup = Store.find("compensation", { where: "{profile} = ?", params: [id] }).find((c) => c.effective === input.compensation.effective);
			const cv = Object.assign({ profile: id }, input.compensation);
			if (dup) Store.update("compensation", dup.id, cv);
			else Store.create("compensation", cv);
		}
		for (const d of input.dependents || []) Store.create("dependent", Object.assign({ profile: id }, d));
		return { id };
	}

	function accounts() {
		return Store.run(
			"SELECT a.id, a.acctnumber, a.accountsearchdisplaynamecopy AS name, a.accttype FROM account a WHERE a.isinactive = 'F' ORDER BY a.acctnumber",
			[],
			"s4vp_accounts"
		).map((a) => ({ id: String(a.id), number: a.acctnumber || "", name: a.name, type: a.accttype }));
	}

	function vendors(subsidiary) {
		return Store.run(
			`SELECT v.id, v.entityid, v.companyname FROM vendor v WHERE v.isinactive = 'F'${subsidiary ? " AND v.subsidiary = ?" : ""} ORDER BY v.entityid`,
			subsidiary ? [subsidiary] : [],
			"s4vp_vendors"
		).map((v) => ({ id: String(v.id), code: v.entityid, name: v.companyname || v.entityid }));
	}

	/** Cập nhật thiết lập chung (chỉ các trường gửi lên). */
	function saveSetup(values) {
		const t = Settings.tenant();
		Store.submit("setup", t.id, values);
		return { id: t.id };
	}

	/** Tạo / cập nhật thiết lập lương theo công ty con. */
	function saveCompany(subsidiary, values) {
		const c = Settings.company(subsidiary);
		if (c) {
			Store.submit("company", c.id, values);
			return { id: c.id };
		}
		return { id: Store.create("company", Object.assign({ name: `Company ${subsidiary}`, subsidiary, enabled: true }, values)) };
	}

	function setInsuranceAccount(code, account, vendor) {
		const rows = Store.find("ins_comp").filter((c) => String(c.name).toUpperCase() === String(code).toUpperCase());
		for (const r of rows) Store.submit("ins_comp", r.id, Object.assign({}, account ? { account } : {}, vendor ? { vendor } : {}));
		return { updated: rows.length };
	}

	return { list, save, accounts, vendors, saveSetup, saveCompany, setInsuranceAccount };
});
