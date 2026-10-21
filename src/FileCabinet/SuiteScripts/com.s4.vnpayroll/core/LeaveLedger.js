/**
 * Sổ phép: số dư theo (nhân viên, loại nghỉ, năm) và giao dịch phép (đặc tả mục 3.6, 3.4; VPLeaveBalance,
 * VPLeaveTransaction).
 *
 * Available = Entitled + CarriedOver + Adjusted - Used - Pending. Giao dịch (Qty dương cấp, âm dùng) cập nhật cột theo
 * nguồn: A Entitled += Qty; C CarriedOver += Qty; X CarriedOver += Qty (Qty âm); R Used -= Qty; J Adjusted += Qty.
 * Pending không có giao dịch, cộng trừ trực tiếp và không âm.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["./Money", "./Dates", "./Errors", "./WorkingDayCounter"], (Money, Dates, Errors, WorkingDayCounter) => {
	const D = Money.D;
	const FIELDS = ["entitled", "carriedOver", "adjusted", "used", "pending"];

	function empty() {
		return { entitled: 0, carriedOver: 0, carryOverExpiryDate: null, adjusted: 0, used: 0, pending: 0 };
	}

	function normalize(b) {
		const out = Object.assign(empty(), b || {});
		for (const f of FIELDS) out[f] = Money.num(out[f]);
		return out;
	}

	function available(b) {
		const x = normalize(b);
		return D(x.entitled).plus(x.carriedOver).plus(x.adjusted).minus(x.used).minus(x.pending).toNumber();
	}

	/** Áp một giao dịch lên số dư, trả số dư mới. */
	function apply(balance, tran) {
		const b = normalize(balance);
		const q = D(tran.qty);
		switch (tran.source) {
			case "A": b.entitled = D(b.entitled).plus(q).toNumber(); break;
			case "C":
			case "X": b.carriedOver = D(b.carriedOver).plus(q).toNumber(); break;
			case "R": b.used = D(b.used).minus(q).toNumber(); break;
			case "J": b.adjusted = D(b.adjusted).plus(q).toNumber(); break;
			default: throw Errors.invalid(`Unknown leave transaction source ${tran.source}.`, `Nguồn giao dịch phép ${tran.source} không hợp lệ.`);
		}
		return b;
	}

	/** Số dư từ danh sách giao dịch (Pending và ngày hết hạn chuyển phép lấy từ base). */
	function fromTransactions(transactions, base) {
		let b = Object.assign(empty(), { pending: Money.num((base || {}).pending), carryOverExpiryDate: (base || {}).carryOverExpiryDate || null });
		for (const t of transactions || []) b = apply(b, t);
		return b;
	}

	function addPending(balance, days) {
		const b = normalize(balance);
		b.pending = Math.max(0, D(b.pending).plus(days).toNumber());
		return b;
	}

	/** Submit đơn dùng số dư: giữ chỗ Pending += Days. */
	function submit(balance, days) {
		return addPending(balance, days);
	}

	/** Approve: Pending -= Days, rồi giao dịch R Qty = -Days (Used += Days). */
	function approve(balance, days) {
		const tran = { source: "R", qty: -Money.num(days) };
		return { balance: apply(addPending(balance, -Money.num(days)), tran), transaction: tran };
	}

	/** Reject: trả giữ chỗ. */
	function reject(balance, days) {
		return addPending(balance, -Money.num(days));
	}

	/** Cancel: đơn Pending trả giữ chỗ; đơn Approved ghi giao dịch R Qty = +Days. */
	function cancel(balance, days, status) {
		if (status === "P") return { balance: addPending(balance, -Money.num(days)), transaction: null };
		if (status === "A") {
			const tran = { source: "R", qty: Money.num(days) };
			return { balance: apply(balance, tran), transaction: tran };
		}
		return { balance: normalize(balance), transaction: null };
	}

	/**
	 * Kế hoạch chuyển phép: CarriedOver > 0 và năm này chưa có giao dịch C thì ghi C +CarriedOver vào năm này và, nếu
	 * có số dư năm trước, J -CarriedOver vào năm trước.
	 */
	function carryOverPlan(carriedOver, hasCarryOverThisYear, hasPrevBalance) {
		if (!(Number(carriedOver) > 0) || hasCarryOverThisYear) return [];
		const out = [{ yearOffset: 0, source: "C", qty: Money.num(carriedOver) }];
		if (hasPrevBalance) out.push({ yearOffset: -1, source: "J", qty: -Money.num(carriedOver) });
		return out;
	}

	/**
	 * Hết hạn phép chuyển (X): số dư có CarryOverExpiryDate <= ngày chạy và CarriedOver > 0;
	 * unused = max(0, CarriedOver - Used) (giả định dùng phép chuyển trước). Luôn xóa ngày hết hạn.
	 * @returns {{transaction: {source, qty}|null, clearExpiry: boolean}}
	 */
	function expiryPlan(balance, runDate) {
		const b = normalize(balance);
		if (!b.carryOverExpiryDate || Dates.cmp(b.carryOverExpiryDate, runDate) > 0 || !(b.carriedOver > 0)) return { transaction: null, clearExpiry: false };
		const unused = Math.max(0, D(b.carriedOver).minus(b.used).toNumber());
		return { transaction: unused > 0 ? { source: "X", qty: -unused } : null, clearExpiry: true };
	}

	/**
	 * Kiểm tra khi Submit đơn nghỉ (3.4). Trả danh sách lỗi {code, message, messageVi}; rỗng là hợp lệ.
	 * @param {Object} req {fromDate, toDate, days, hasAttachment}
	 * @param {Object} leaveType {usesBalance, requiresAttachment, maxDaysPerRequest}
	 * @param {number|null} availableDays số dư khả dụng năm FromDate (khi dùng số dư)
	 * @param {Array<{fromDate, toDate, status}>} others đơn nghỉ khác của nhân viên
	 */
	function validateSubmit(req, leaveType, availableDays, others) {
		const errs = [];
		const lt = leaveType || {};
		const days = Number(req.days) || 0;
		if (lt.requiresAttachment && !req.hasAttachment) errs.push({ code: "ATTACHMENT", message: "Attach a supporting document before submitting.", messageVi: "Cần đính kèm chứng từ trước khi gửi duyệt." });
		if (!(days > 0)) errs.push({ code: "DAYS", message: "The number of days must be greater than zero.", messageVi: "Số ngày nghỉ phải lớn hơn 0." });
		if (Number(lt.maxDaysPerRequest) > 0 && days > Number(lt.maxDaysPerRequest)) errs.push({ code: "MAX", message: `A request cannot exceed ${lt.maxDaysPerRequest} days.`, messageVi: `Mỗi đơn không quá ${lt.maxDaysPerRequest} ngày.` });
		if (lt.usesBalance && days > Number(availableDays || 0)) errs.push({ code: "BALANCE", message: `Insufficient leave balance (${availableDays || 0} available).`, messageVi: `Số dư phép không đủ (còn ${availableDays || 0} ngày).` });
		for (const o of others || []) {
			if ((o.status === "P" || o.status === "A") && Dates.cmp(o.fromDate, req.toDate) <= 0 && Dates.cmp(o.toDate, req.fromDate) >= 0) {
				errs.push({ code: "OVERLAP", message: "The request overlaps another pending or approved request.", messageVi: "Đơn trùng ngày với đơn khác đang chờ duyệt hoặc đã duyệt." });
				break;
			}
		}
		return errs;
	}

	/** Số ngày đơn nghỉ (Days) theo nửa ngày, bỏ nghỉ tuần và lễ. */
	function requestDays(req, weeklyOff, holidays) {
		return WorkingDayCounter.count(req.fromDate, req.toDate, weeklyOff, holidays, req.fromHalf || "A", req.toHalf || "P");
	}

	return { empty, available, apply, fromTransactions, submit, approve, reject, cancel, carryOverPlan, expiryPlan, validateSubmit, requestDays };
});
