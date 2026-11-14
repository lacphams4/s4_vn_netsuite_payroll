/**
 * Hồ sơ lương nhân viên (VP203000) kèm lịch sử lương và người phụ thuộc; danh mục cho màn hình thiết lập
 * (tài khoản, nhà cung cấp). Dữ liệu lương nhạy cảm: không ghi số tiền, số định danh vào log.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Store", "./Settings", "./Access"], (Store, Settings, Access) => {
	const blank = (v) => v === null || v === undefined || v === "";
	/** Lỗi nghiệp vụ hai ngôn ngữ: RESTlet trả userMessage.en / userMessage.vi, giao diện hiện đúng một ngôn ngữ. */
	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}


	// Số định danh: API danh sách luôn trả dạng che (4 ký tự cuối) kèm cờ has*; số đầy đủ chỉ lấy qua revealIds (có nhật ký)
	const ID_FIELDS = ["tax_code", "personal_id", "si_number", "bank_account"];

	function maskProfile(p) {
		const o = Object.assign({}, p);
		for (const k of ID_FIELDS) {
			o[`has_${k}`] = !blank(o[k]);
			o[k] = Access.mask(o[k]);
		}
		return o;
	}

	/** Số định danh đầy đủ của một nhân viên, cho vai trò có gói quyền "ids". Nơi gọi ghi nhật ký. */
	function revealIds(employee) {
		if (!Access.canIds()) throw fail("Your role is not allowed to view full identifiers", "Vai trò của bạn không được xem số định danh đầy đủ");
		if (blank(employee)) throw fail("Employee is required", "Thiếu nhân viên");
		const p = Store.find("employee", { where: "{employee} = ?", params: [employee], includeInactive: true })[0];
		if (!p) throw fail("Payroll profile not found", "Không tìm thấy hồ sơ lương");
		const out = { employee: String(employee) };
		for (const k of ID_FIELDS) out[k] = p[k] || "";
		return out;
	}

	/** Nhân viên của subsidiary kèm hồ sơ lương (nếu có) và lịch sử lương mới nhất (chỉ khi vai trò được xem tiền lương). */
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
		const pay = Access.canPay();
		if (pay) for (const c of Store.findIn("compensation", "profile", profIds)) if (!comps[c.profile] || c.effective > comps[c.profile].effective) comps[c.profile] = c;
		const deps = {};
		if (pay) for (const d of Store.findIn("dependent", "profile", profIds)) deps[d.profile] = (deps[d.profile] || 0) + 1;
		return emps.map((e) => {
			const p = profiles[String(e.id)];
			const c = p ? comps[p.id] : null;
			return {
				employee: String(e.id), code: e.entityid, name: [e.lastname, e.firstname].filter(Boolean).join(" ") || e.entityid, inactive: e.isinactive === "T", department: e.dept || "",
				profile: p ? maskProfile(p) : null, compensation: pay ? c : null, payHidden: !pay, dependents: p ? deps[p.id] || 0 : 0,
			};
		});
	}

	/**
	 * Tạo / cập nhật hồ sơ lương và (tùy chọn) thêm dòng lịch sử lương, người phụ thuộc.
	 * @param {{employee, subsidiary, profile: object, compensation?: {effective, base_salary, insurance_wage, allowance, package}, dependents?: Array}} input
	 */
	function save(input) {
		if (blank(input.employee) || blank(input.subsidiary)) throw fail("Employee and subsidiary are required", "Thiếu nhân viên hoặc công ty con");
		const existing = Store.find("employee", { where: "{employee} = ?", params: [input.employee], includeInactive: true })[0];
		const values = Object.assign({ employee: input.employee, subsidiary: input.subsidiary }, input.profile || {});
		// Giá trị che do list() trả về (hoặc cờ has_*) quay lại từ biểu mẫu: bỏ, không ghi đè số thật
		for (const k of Object.keys(values)) if (k.indexOf("has_") === 0) delete values[k];
		for (const k of ID_FIELDS) if (Access.isMasked(values[k])) delete values[k];
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
		// Người phụ thuộc: chỉ thêm khi chưa có (trùng tên và ngày giảm trừ từ), lưu lại nhiều lần không nhân đôi giảm trừ (QC #21)
		if ((input.dependents || []).length) {
			const norm = (x) => String(x || "").trim().toUpperCase();
			const have = new Set(Store.find("dependent", { where: "{profile} = ?", params: [id], includeInactive: true }).map((d) => `${norm(d.name)}|${d.from || ""}`));
			for (const d of input.dependents) {
				const key = `${norm(d.name)}|${d.from || ""}`;
				if (have.has(key)) continue;
				have.add(key);
				Store.create("dependent", Object.assign({ profile: id }, d));
			}
		}
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

	return { revealIds, list, save, accounts, vendors, saveSetup, saveCompany, setInsuranceAccount };
});
