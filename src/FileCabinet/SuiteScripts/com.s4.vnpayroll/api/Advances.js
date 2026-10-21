/**
 * Phiếu tạm ứng lương (VP301000, đặc tả 1.2.6, 4.6.4): tạo, bỏ tạm giữ, ghi sổ Nợ 141 / Có tiền.
 * Cấn trừ khi ghi sổ bảng lương và hoàn khi đảo nằm ở api/Payroll.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/runtime", "./Store", "./Settings", "./Payroll", "../core/PayrollJournalBuilder"], (runtime, Store, Settings, Payroll, Journal) => {
	function fail(en, vi) {
		const e = new Error(`${en} / ${vi}`);
		e.userMessage = { en, vi };
		return e;
	}

	function create(input) {
		if (!(Number(input.amount) > 0)) throw fail("The advance amount must be greater than zero", "Số tiền tạm ứng phải lớn hơn 0");
		return Store.create("advance", {
			subsidiary: input.subsidiary, employee: input.employee, doc_date: input.docDate, amount: Number(input.amount), cash_account: input.cashAccount || null,
			project: input.project || null, memo: input.memo || "", status: "H", offset: 0, balance: 0,
		});
	}

	function removeHold(id) {
		const a = Store.get("advance", id);
		if (!a || a.status !== "H") throw fail("Only on-hold advances", "Chỉ áp dụng cho phiếu tạm ứng đang tạm giữ");
		if (!a.cash_account) throw fail("The cash account is required", "Chưa chọn tài khoản tiền");
		Store.submit("advance", id, { status: "B" });
	}

	function release(id) {
		const a = Store.get("advance", id);
		if (!a || a.status !== "B") throw fail("Only advances pending release", "Chỉ ghi sổ phiếu tạm ứng chờ ghi sổ");
		if (a.journal) throw fail("The advance already has a journal entry", "Phiếu tạm ứng đã có bút toán");
		const settings = Settings.resolve(a.subsidiary, null);
		if (!settings.accounts.acc_advance) throw fail("Advance account (141) is not configured", "Chưa khai TK tạm ứng (141)");
		const code = Store.run("SELECT entityid FROM employee WHERE id = ?", [a.employee], "s4vp_adv_emp")[0];
		const lang = /^vi/i.test(String(runtime.getCurrentUser().getPreference({ name: "LANGUAGE" }) || "")) ? "vi" : "en";
		const je = Journal.buildAdvance({ refNbr: a.name, employeeCode: code ? code.entityid : a.employee, amount: a.amount, project: a.project || "", branch: "", date: a.doc_date }, {
			advanceAccount: settings.accounts.acc_advance, cashAccount: a.cash_account, lang,
		});
		const jeId = Payroll.createJournal(a.subsidiary, a.doc_date, je.memo, je.lines, settings.location);
		Store.submit("advance", id, { journal: jeId, status: "O", balance: a.amount, offset: 0 });
		return { journal: jeId };
	}

	function list(filter = {}) {
		return Store.find("advance", { order: "{id} DESC" }).filter((a) => !filter.subsidiary || a.subsidiary === String(filter.subsidiary));
	}

	return { create, removeHold, release, list };
});
