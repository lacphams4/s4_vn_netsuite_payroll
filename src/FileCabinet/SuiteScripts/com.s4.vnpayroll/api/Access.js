/**
 * Lớp quyền dùng chung của gói lương: vai trò hiệu lực, gói quyền theo trường và phạm vi công ty con của người đang thao tác.
 *
 * Mô hình (docs/BAO_MAT_LUONG_SO_SANH.md): quyền = GÓI TRƯỜNG x PHẠM VI.
 *   - Gói trường: "profile" (hồ sơ, công, phép, ca), "pay" (mọi số tiền lương, bảng lương, tạm ứng, hoa hồng, chi phí),
 *     "ids" (số định danh đầy đủ: MST, CCCD, số sổ BHXH, số tài khoản ngân hàng).
 *   - Phạm vi: công ty con mà vai trò NetSuite của người dùng được phép (null = không giới hạn).
 *
 * Vai trò hiệu lực: vai trò NetSuite thật được quy về một vai trò chuẩn của gói. Vai trò do khách nhân bản (ví dụ "HR công ty A",
 * giới hạn công ty con A) khai ở Thiết lập chung, trường "Vai trò tương đương ..." (script id, cách nhau dấu phẩy); mọi mô-đun
 * hỏi Access.role() nên vai trò nhân bản có đúng quyền của vai trò chuẩn.
 *
 * Mô-đun này chỉ phụ thuộc N/runtime. Dữ liệu cần truy vấn (bảng vai trò tương đương, công ty con được phép) do nơi gọi nạp
 * qua configure() - api/Dispatch làm việc đó ở đầu mỗi yêu cầu. Chưa configure (Map/Reduce, Suitelet chạy bằng vai trò ẩn,
 * User Event) thì không giới hạn công ty con và vai trò hiệu lực = vai trò thật.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime"], (runtime) => {
	const ADMIN = "administrator";
	const HR = "customrole_s4vp_hr";
	const ACCT = "customrole_s4vp_accountant";
	const OPS = "customrole_s4vp_hr_ops";
	const DEMO = "customrole_s4vp_demo";
	const KNOWN = [ADMIN, HR, ACCT, OPS, DEMO];
	// Vai trò được xem số tiền lương; vai trò được xem số định danh đầy đủ
	const PAY_ROLES = [ADMIN, HR, ACCT, DEMO];
	const ID_ROLES = [ADMIN, HR, DEMO];

	let providers = null;
	let aliasMap = null;
	let subsLoaded = false;
	let subs = null;

	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	/**
	 * @param {{aliases?: function(): Object<string,string>, subsidiaries?: function(): (string[]|null)}} p
	 *   aliases: trả {script id vai trò nhân bản (chữ thường): vai trò chuẩn}; subsidiaries: trả danh sách id công ty con được
	 *   phép, hoặc null khi không giới hạn. Cả hai được gọi tối đa một lần cho mỗi lần thực thi script.
	 */
	function configure(p) {
		providers = p || null;
		aliasMap = null;
		subsLoaded = false;
		subs = null;
	}

	function realRole() {
		try {
			return String(runtime.getCurrentUser().roleId || "").toLowerCase();
		} catch (e) {
			return "";
		}
	}

	/** Vai trò hiệu lực: vai trò chuẩn của gói, hoặc vai trò chuẩn mà vai trò nhân bản được khai tương đương. */
	function role() {
		const r = realRole();
		if (!r || KNOWN.includes(r)) return r;
		if (aliasMap === null) {
			aliasMap = {};
			try {
				if (providers && typeof providers.aliases === "function") aliasMap = providers.aliases() || {};
			} catch (e) {
				aliasMap = {};
			}
		}
		const hit = aliasMap[r];
		// Không cho khai vai trò tương đương Administrator
		return hit && hit !== ADMIN && KNOWN.includes(hit) ? hit : r;
	}

	/** Đổi chuỗi "role_a, role_b" của một trường thiết lập thành bảng {role_a: target, role_b: target}. */
	function parseAliases(text, target, into) {
		const out = into || {};
		for (const part of String(text || "").split(/[,;\s]+/)) {
			const id = part.trim().toLowerCase();
			if (id && !KNOWN.includes(id)) out[id] = target;
		}
		return out;
	}

	function isAdmin() {
		return role() === ADMIN;
	}

	/** Vai trò thuộc gói (được dùng API của gói). */
	function isMember() {
		return KNOWN.includes(role());
	}

	/** Được xem và thao tác số tiền lương. */
	function canPay() {
		return PAY_ROLES.includes(role());
	}

	/** Được xem số định danh đầy đủ. */
	function canIds() {
		return ID_ROLES.includes(role());
	}

	/** Danh sách id công ty con được phép (chuỗi), hoặc null khi không giới hạn. */
	function subsidiaries() {
		if (subsLoaded) return subs;
		subsLoaded = true;
		subs = null;
		if (!providers || typeof providers.subsidiaries !== "function") return subs;
		if (realRole() === ADMIN) return subs;
		try {
			const list = providers.subsidiaries();
			subs = Array.isArray(list) ? [...new Set(list.map((x) => String(x)).filter((x) => /^\d+$/.test(x)))] : null;
		} catch (e) {
			// Không xác định được phạm vi: an toàn là không cho thấy công ty con nào
			subs = [];
		}
		return subs;
	}

	function restricted() {
		return subsidiaries() !== null;
	}

	function allowsSubsidiary(id) {
		const list = subsidiaries();
		if (list === null) return true;
		if (id === null || id === undefined || id === "") return false;
		return list.includes(String(id));
	}

	function assertSubsidiary(id) {
		if (!allowsSubsidiary(id)) throw fail("Your role is not allowed to access this subsidiary", "Vai trò của bạn không được truy cập công ty con này");
	}

	/** Che số định danh: giữ 4 ký tự cuối, phần đầu thay bằng dấu sao. Trống giữ trống. */
	function mask(value) {
		const s = value === null || value === undefined ? "" : String(value);
		if (!s) return "";
		const tail = s.length > 4 ? s.slice(-4) : "";
		return "*".repeat(Math.max(4, s.length - tail.length)) + tail;
	}

	/** Chuỗi có phải giá trị đã che (do mask() tạo) không - dùng khi lưu để không ghi đè số thật bằng giá trị che. */
	function isMasked(value) {
		return /^\*{4,}/.test(String(value === null || value === undefined ? "" : value));
	}

	return {
		ROLES: { ADMIN, HR, ACCT, OPS, DEMO },
		configure, realRole, role, parseAliases, isAdmin, isMember, canPay, canIds,
		subsidiaries, restricted, allowsSubsidiary, assertSubsidiary, mask, isMasked,
	};
});
