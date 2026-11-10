/**
 * Bộ quy tắc kiểm tra bảng lương trước khi duyệt (giao diện bản 2, docs/UI_V2.md mục 9; mẫu docs/design/CanhBao.dc.html).
 * Lõi thuần: nhận dữ liệu đã đọc sẵn (dòng kỳ này, dòng kỳ trước, hồ sơ, giờ công), trả danh sách cảnh báo. Không lưu gì:
 * cảnh báo được tính lại mỗi lần đọc; chỉ trạng thái xử lý (ghi chú, người phụ trách) lưu ở record và ghép lại theo khóa.
 *
 * evaluate(input) -> items
 *   input.lines          dòng nhân viên kỳ này: { id, employee, employment_type, std_days, work_days, net, insurance_wage, error }
 *   input.prevLines      dòng nhân viên của bảng lương kỳ trước (null / undefined = không có kỳ trước để so)
 *   input.profiles       { <employee>: { salary_type, employment_type, hire_date, termination_date, ins_applicable, region,
 *                          hasTaxCode, hasBank } } - hasTaxCode / hasBank là cờ có / không; lõi không nhận và không trả
 *                          giá trị mã số thuế hay tài khoản
 *   input.hours          { <employee>: tổng giờ tính lương của bảng lương }
 *   input.manualEarnings { <employee>: số dòng thu nhập nhập tay }
 *   input.period         { start, end, attLocked } (ISO yyyy-mm-dd); input.prevPeriod { start, end } nếu có
 *   input.options        { calculated, netChangeThreshold, minInsuranceWage, defaultRegion }
 *       calculated: false -> bỏ các quy tắc dựa trên số đã tính (thực lĩnh, chênh lệch, lương đóng bảo hiểm)
 *       netChangeThreshold: tỷ lệ thập phân (0.2 = 20%); thiếu -> DEFAULT_NET_CHANGE
 *       minInsuranceWage: số, hoặc { <vùng>: số }; thiếu / không có mức cho vùng -> bỏ qua quy tắc INS_BELOW_MIN
 *         (mức tối thiểu là tham số của thiết lập, lõi không mang giá trị pháp lý nào)
 *
 * Mỗi cảnh báo: { key, rule, severity: "error" | "warn" | "info", employee, lineId, amount, data }
 *   key = rule + ":" + employee, hoặc rule với cảnh báo cấp bảng lương (employee = null).
 *
 * Mức độ: error chặn duyệt (blocking), phải sửa dữ liệu rồi tính lại, không đóng tay được; warn cần người xem và chấp nhận
 * hoặc xử lý; info chỉ để biết (không tính vào số việc còn mở).
 *
 * describe(item, lang) -> { title, headline, description, hint } (vi / en); merge(items, stored) ghép trạng thái đã lưu;
 * counts(items) -> { open, errors, warnings, resolved }; blocking(items); sort(items); fingerprint(item).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
	const DEFAULT_NET_CHANGE = 0.2;
	const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
	const STATUSES = ["open", "accepted", "resolved"];

	const blank = (v) => v === null || v === undefined || v === "";
	const num = (v) => {
		const n = Number(v);
		return blank(v) || !isFinite(n) ? 0 : n;
	};
	const truthy = (v) => v === true || v === "T" || v === 1 || v === "1" || v === "true";
	const iso = (v) => (blank(v) ? "" : String(v).slice(0, 10));
	const within = (d, from, to) => !!d && !!from && !!to && d >= from && d <= to;

	// ------------------------------------------------------------------ danh mục quy tắc

	const pctText = (ratio, lang) => {
		const v = Math.round(Math.abs(num(ratio)) * 1000) / 10;
		const s = String(v);
		return (lang === "vi" ? s.replace(".", ",") : s) + "%";
	};
	const dmy = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? String(d).split("-").reverse().join("/") : String(d || ""));

	/**
	 * Mỗi quy tắc: severity, scope ("employee" | "batch"), title / description / hint là { vi, en }, mỗi bên là chuỗi hoặc
	 * hàm (data, lang) -> chuỗi; headline (tùy chọn) là câu ngắn đặt cạnh tên nhân viên ở tiêu đề màn chi tiết.
	 */
	const RULES = {
		NO_EMPLOYEES: {
			severity: "error", scope: "batch",
			title: { vi: "Bảng lương chưa có nhân viên", en: "The payroll batch has no employees" },
			description: { vi: "Bảng lương chưa có dòng nhân viên nào nên chưa thể tính và duyệt.", en: "The batch has no employee lines, so it cannot be calculated or approved." },
			hint: { vi: "Mở bảng lương, bấm Nạp nhân viên. Nếu vẫn trống, kiểm tra nhóm lương và công ty con trên hồ sơ lương.", en: "Open the batch and click Load employees. If it stays empty, check the pay group and subsidiary on the payroll profiles." },
		},
		CALC_ERROR: {
			severity: "error", scope: "employee",
			title: { vi: "Lỗi khi tính lương", en: "Calculation error" },
			headline: { vi: "lỗi khi tính lương", en: "calculation error" },
			description: {
				vi: (d) => `Dòng nhân viên này tính không thành công${d.message ? `: ${d.message}` : "."} Các số của dòng đang bằng 0.`,
				en: (d) => `This employee line failed to calculate${d.message ? `: ${d.message}` : "."} The line amounts are zero.`,
			},
			hint: { vi: "Sửa dữ liệu theo nội dung lỗi (hồ sơ lương, lịch sử lương, giấy phép lao động...) rồi tính lại bảng lương.", en: "Fix the data named in the message (payroll profile, compensation history, work permit...) and recalculate the batch." },
		},
		MISSING_PROFILE: {
			severity: "error", scope: "employee",
			title: { vi: "Nhân viên chưa có hồ sơ lương", en: "Payroll profile is missing" },
			headline: { vi: "chưa có hồ sơ lương", en: "no payroll profile" },
			description: { vi: "Nhân viên có trong bảng lương nhưng không tìm thấy hồ sơ lương đang hoạt động, nên không tính được lương.", en: "The employee is on the batch but has no active payroll profile, so pay cannot be calculated." },
			hint: { vi: "Vào Nhân sự, tạo hồ sơ lương cho nhân viên, hoặc gỡ dòng này khỏi bảng lương.", en: "Open Employees and create the payroll profile, or remove this line from the batch." },
		},
		NET_NEGATIVE: {
			severity: "error", scope: "employee",
			title: { vi: "Thực lĩnh âm", en: "Negative net pay" },
			headline: { vi: "thực lĩnh âm", en: "negative net pay" },
			description: { vi: "Các khoản khấu trừ lớn hơn thu nhập của kỳ nên thực lĩnh nhỏ hơn 0. Không thể chi lương số âm.", en: "Deductions exceed the earnings of the period, so net pay is below zero. A negative amount cannot be paid." },
			hint: { vi: "Kiểm tra khấu trừ nhập tay, cấn trừ tạm ứng và ngày công; giảm hoặc dời khoản khấu trừ sang kỳ sau rồi tính lại.", en: "Check manual deductions, advance offsets and work days; reduce or move the deduction to a later period, then recalculate." },
		},
		NET_ZERO: {
			severity: "warn", scope: "employee",
			title: { vi: "Thực lĩnh bằng 0", en: "Net pay is zero" },
			headline: { vi: "thực lĩnh bằng 0", en: "net pay is zero" },
			description: { vi: "Nhân viên có trong bảng lương nhưng không có thực lĩnh trong kỳ.", en: "The employee is on the batch but has no net pay for the period." },
			hint: { vi: "Kiểm tra ngày công, giờ công và lương hợp đồng. Nếu đúng là nghỉ không lương cả kỳ thì chấp nhận cảnh báo và ghi chú lý do.", en: "Check work days, hours and the contract salary. If the employee was on unpaid leave for the whole period, accept the check and note the reason." },
		},
		NO_HOURS: {
			severity: "warn", scope: "employee",
			title: { vi: "Nhân viên lương giờ chưa có giờ công", en: "Hourly employee without payroll hours" },
			headline: { vi: "chưa có giờ công", en: "no payroll hours" },
			description: { vi: "Nhân viên hưởng lương theo giờ nhưng bảng lương chưa có giờ công và không có khoản nhập tay, nên lương kỳ này sẽ bằng 0.", en: "The employee is paid by the hour but the batch has no payroll hours and no manual earning, so pay for this period will be zero." },
			hint: { vi: "Mở bảng lương, bấm Nạp giờ công (timesheet đã duyệt) hoặc nhập giờ tay, sau đó tính lại.", en: "Open the batch and click Load time (approved timesheets) or enter the hours manually, then recalculate." },
		},
		NO_ATTENDANCE: {
			severity: "warn", scope: "employee",
			title: { vi: "Không có ngày công trong kỳ", en: "No work days in the period" },
			headline: { vi: "không có ngày công", en: "no work days" },
			description: { vi: "Công hưởng lương của nhân viên trong kỳ bằng 0 trong khi công chuẩn lớn hơn 0.", en: "The paid work days of the employee are zero while the standard days of the period are above zero." },
			hint: { vi: "Kiểm tra bảng công của kỳ (đơn nghỉ, ngày vào làm, ngày nghỉ việc). Sửa công rồi bấm Nạp nhân viên để áp lại, hoặc chấp nhận nếu nhân viên nghỉ cả kỳ.", en: "Check the attendance of the period (leave requests, hire date, last working day). Fix it and click Load employees to apply it again, or accept the check if the employee was away for the whole period." },
		},
		NET_CHANGE: {
			severity: "warn", scope: "employee",
			title: { vi: (d, lang) => `Thực lĩnh lệch trên ${pctText(d.threshold, lang)} so với kỳ trước`, en: (d, lang) => `Net pay changed by more than ${pctText(d.threshold, lang)} from the previous period` },
			headline: { vi: (d, lang) => `thực lĩnh ${num(d.diff) >= 0 ? "tăng" : "giảm"} ${pctText(d.ratio, lang)}`, en: (d, lang) => `net pay ${num(d.diff) >= 0 ? "up" : "down"} ${pctText(d.ratio, lang)}` },
			description: {
				vi: (d, lang) => `Thực lĩnh kỳ này ${num(d.diff) >= 0 ? "tăng" : "giảm"} ${pctText(d.ratio, lang)} so với kỳ trước, vượt ngưỡng ${pctText(d.threshold, lang)}.`,
				en: (d, lang) => `Net pay is ${num(d.diff) >= 0 ? "up" : "down"} ${pctText(d.ratio, lang)} from the previous period, above the ${pctText(d.threshold, lang)} threshold.`,
			},
			hint: { vi: "So sánh từng khoản với kỳ trước ở bảng bên dưới: khoản nhập tay, làm thêm, ngày công, thay đổi lương. Hợp lệ thì chấp nhận và ghi chú lý do; sai thì sửa dữ liệu rồi tính lại.", en: "Compare each amount with the previous period in the table below: manual lines, overtime, work days, salary changes. Accept with a note when it is valid; otherwise fix the data and recalculate." },
		},
		INS_BELOW_MIN: {
			severity: "warn", scope: "employee",
			title: { vi: "Lương đóng bảo hiểm thấp hơn mức tối thiểu trong thiết lập", en: "Insurance wage is below the minimum in setup" },
			headline: { vi: "lương đóng bảo hiểm dưới mức tối thiểu", en: "insurance wage below the minimum" },
			description: {
				vi: (d) => `Lương đóng bảo hiểm của nhân viên thấp hơn mức tối thiểu đang khai trong thiết lập${d.region ? ` (vùng ${d.region})` : ""}${d.param ? `, tham số ${d.param}` : ""}.`,
				en: (d) => `The insurance wage of the employee is below the minimum defined in setup${d.region ? ` (region ${d.region})` : ""}${d.param ? `, parameter ${d.param}` : ""}.`,
			},
			hint: { vi: "Kiểm tra lương đóng bảo hiểm ở lịch sử lương và vùng lương trên hồ sơ. Trường hợp hợp lệ (ví dụ làm việc không trọn thời gian) thì chấp nhận và ghi chú.", en: "Check the insurance wage in the compensation history and the wage region on the profile. Accept with a note when it is valid (for example part-time work)." },
		},
		MISSING_TAX_CODE: {
			severity: "warn", scope: "employee",
			title: { vi: "Thiếu mã số thuế cá nhân", en: "Personal tax code is missing" },
			headline: { vi: "thiếu mã số thuế", en: "no tax code" },
			description: { vi: "Hồ sơ lương của nhân viên chưa có mã số thuế cá nhân. Tờ khai và chứng từ khấu trừ thuế cần thông tin này.", en: "The payroll profile has no personal tax code. Tax returns and withholding certificates need it." },
			hint: { vi: "Mở hồ sơ lương của nhân viên và bổ sung mã số thuế. Không ảnh hưởng số tiền của bảng lương.", en: "Open the payroll profile and add the tax code. Payroll amounts are not affected." },
		},
		MISSING_BANK: {
			severity: "warn", scope: "employee",
			title: { vi: "Thiếu thông tin nhận lương", en: "Payment details are missing" },
			headline: { vi: "thiếu thông tin nhận lương", en: "no payment details" },
			description: { vi: "Hồ sơ lương của nhân viên chưa đủ ngân hàng và số tài khoản nên nhân viên sẽ không có trong file chi lương ngân hàng.", en: "The payroll profile lacks the bank or the account number, so the employee will be missing from the bank payment file." },
			hint: { vi: "Mở hồ sơ lương của nhân viên và bổ sung ngân hàng, số tài khoản. Nếu trả tiền mặt thì chấp nhận và ghi chú.", en: "Open the payroll profile and add the bank and account number. Accept with a note if the employee is paid in cash." },
		},
		LEFT_BEFORE_PERIOD: {
			severity: "warn", scope: "employee",
			title: { vi: "Nhân viên đã nghỉ việc trước kỳ lương", en: "Employee left before the pay period" },
			headline: { vi: "đã nghỉ việc trước kỳ", en: "left before the period" },
			description: { vi: (d) => `Ngày làm việc cuối trên hồ sơ lương là ${dmy(d.date)}, trước ngày bắt đầu kỳ, nhưng nhân viên vẫn có trong bảng lương.`, en: (d) => `The last working day on the payroll profile is ${dmy(d.date)}, before the period starts, but the employee is still on the batch.` },
			hint: { vi: "Gỡ dòng nhân viên khỏi bảng lương nếu không còn khoản phải trả; nếu còn khoản quyết toán thì chấp nhận và ghi chú.", en: "Remove the line from the batch when nothing is owed; accept with a note when there is a final settlement." },
		},
		NEW_EMPLOYEE: {
			severity: "info", scope: "employee",
			title: { vi: "Nhân viên mới trong kỳ", en: "New employee in the period" },
			headline: { vi: "nhân viên mới", en: "new employee" },
			description: {
				vi: (d) => (d.reason === "hired" ? `Nhân viên vào làm ngày ${dmy(d.date)}, trong kỳ lương này. Lương được chia theo ngày công thực tế.` : "Nhân viên không có trong bảng lương kỳ trước của cùng nhóm lương."),
				en: (d) => (d.reason === "hired" ? `The employee was hired on ${dmy(d.date)}, within this pay period. Pay is prorated by actual work days.` : "The employee was not on the previous payroll batch of the same pay group."),
			},
			hint: { vi: "Kiểm tra ngày vào làm, lương hợp đồng, người phụ thuộc và thông tin nhận lương trên hồ sơ.", en: "Check the hire date, contract salary, dependents and payment details on the profile." },
		},
		LEAVER: {
			severity: "info", scope: "employee",
			title: { vi: "Nhân viên nghỉ việc trong kỳ", en: "Employee leaving in the period" },
			headline: { vi: "nghỉ việc trong kỳ", en: "leaving in the period" },
			description: { vi: (d) => `Ngày làm việc cuối là ${dmy(d.date)}, trong kỳ lương này. Lương được chia theo ngày công; phép còn lại được trả theo thiết lập.`, en: (d) => `The last working day is ${dmy(d.date)}, within this pay period. Pay is prorated by work days; remaining leave is paid out as configured.` },
			hint: { vi: "Kiểm tra ngày công, khoản trả phép còn lại và các khoản tạm ứng chưa cấn trừ hết.", en: "Check work days, the leave payout and any advance that is not fully offset." },
		},
		NOT_IN_BATCH: {
			severity: "info", scope: "employee",
			title: { vi: "Có ở kỳ trước nhưng không có ở kỳ này", en: "On the previous batch but not on this one" },
			headline: { vi: "không có trong bảng lương kỳ này", en: "not on this batch" },
			description: { vi: "Nhân viên có trong bảng lương kỳ trước của cùng nhóm lương nhưng không có dòng trong bảng lương này.", en: "The employee was on the previous payroll batch of the same pay group but has no line on this one." },
			hint: { vi: "Nếu nhân viên còn làm việc, mở bảng lương và bấm Nạp nhân viên; kiểm tra nhóm lương và trạng thái hồ sơ lương.", en: "If the employee still works here, open the batch and click Load employees; check the pay group and the status of the payroll profile." },
		},
		ATT_NOT_LOCKED: {
			severity: "info", scope: "batch",
			title: { vi: "Công của kỳ chưa khóa", en: "Attendance of the period is not locked" },
			description: { vi: "Bảng công của kỳ còn mở: ngày công có thể thay đổi sau khi tính lương.", en: "The attendance of the period is still open: work days may change after the calculation." },
			hint: { vi: "Vào Chấm công, xử lý ngoại lệ rồi khóa công; sau đó nạp nhân viên và tính lại bảng lương.", en: "Open Attendance, clear the exceptions and lock the period; then load employees and recalculate the batch." },
		},
	};

	// ------------------------------------------------------------------ tính cảnh báo

	function make(rule, line, employee, amount, data) {
		const emp = blank(employee) ? null : String(employee);
		return {
			key: emp ? `${rule}:${emp}` : rule,
			rule,
			severity: RULES[rule].severity,
			employee: emp,
			lineId: line && !blank(line.id) ? String(line.id) : null,
			amount: blank(amount) ? null : num(amount),
			data: data || {},
		};
	}

	function minWageFor(option, region) {
		if (blank(option)) return null;
		if (typeof option === "object") {
			const v = option[String(region || "")];
			return blank(v) || !(num(v) > 0) ? null : num(v);
		}
		return num(option) > 0 ? num(option) : null;
	}

	function evaluate(input) {
		const src = input || {};
		const lines = Array.isArray(src.lines) ? src.lines : [];
		const hasPrev = Array.isArray(src.prevLines);
		const prevLines = hasPrev ? src.prevLines : [];
		const profiles = src.profiles || {};
		const hours = src.hours || {};
		const manual = src.manualEarnings || {};
		const period = src.period || {};
		const prevPeriod = src.prevPeriod || {};
		const opt = src.options || {};
		const calculated = opt.calculated !== false;
		const threshold = num(opt.netChangeThreshold) > 0 ? num(opt.netChangeThreshold) : DEFAULT_NET_CHANGE;
		const start = iso(period.start);
		const end = iso(period.end);
		const items = [];

		if (!lines.length) {
			items.push(make("NO_EMPLOYEES", null, null, null, {}));
			return items;
		}

		const prevByEmp = {};
		for (const l of prevLines) if (l && !blank(l.employee)) prevByEmp[String(l.employee)] = l;
		const seen = {};

		for (const line of lines) {
			if (!line || blank(line.employee)) continue;
			const emp = String(line.employee);
			if (seen[emp]) continue;
			seen[emp] = true;
			const prof = profiles[emp] || null;
			const hasError = !blank(line.error);
			const net = num(line.net);
			const hired = prof ? iso(prof.hire_date) : "";
			const left = prof ? iso(prof.termination_date) : "";
			const hiredInPeriod = within(hired, start, end);
			const leftInPeriod = within(left, start, end);
			const employment = (prof && prof.employment_type) || line.employment_type || "E";

			if (hasError) items.push(make("CALC_ERROR", line, emp, null, { message: String(line.error).slice(0, 300) }));
			if (!prof) {
				// Lỗi tính lương đã nói lý do thiếu hồ sơ: không báo hai lần
				if (!hasError) items.push(make("MISSING_PROFILE", line, emp, null, {}));
			} else {
				const salaryType = prof.salary_type || "M";
				if (salaryType === "H") {
					if (!(num(hours[emp]) > 0) && !(num(manual[emp]) > 0)) items.push(make("NO_HOURS", line, emp, null, { hours: num(hours[emp]) }));
				} else if (employment !== "C" && num(line.std_days) > 0 && !(num(line.work_days) > 0)) {
					items.push(make("NO_ATTENDANCE", line, emp, null, { stdDays: num(line.std_days), workDays: num(line.work_days) }));
				}
				if (!truthy(prof.hasTaxCode)) items.push(make("MISSING_TAX_CODE", line, emp, null, {}));
				if (!truthy(prof.hasBank) && (!calculated || net > 0)) items.push(make("MISSING_BANK", line, emp, null, {}));
				if (left && start && left < start) items.push(make("LEFT_BEFORE_PERIOD", line, emp, null, { date: left }));
				if (leftInPeriod) items.push(make("LEAVER", line, emp, null, { date: left }));
				if (hiredInPeriod) items.push(make("NEW_EMPLOYEE", line, emp, null, { reason: "hired", date: hired }));
				else if (hasPrev && !prevByEmp[emp]) items.push(make("NEW_EMPLOYEE", line, emp, null, { reason: "notInPrev" }));
			}

			if (calculated && !hasError) {
				if (net < 0) items.push(make("NET_NEGATIVE", line, emp, net, { net }));
				else if (net === 0) items.push(make("NET_ZERO", line, emp, 0, { net: 0 }));

				const prev = prevByEmp[emp];
				const prevNet = prev && blank(prev.error) ? num(prev.net) : 0;
				const hiredInPrev = within(hired, iso(prevPeriod.start), iso(prevPeriod.end));
				// Thực lĩnh âm hoặc bằng 0 đã có cảnh báo riêng: không báo thêm chênh lệch cho cùng một nguyên nhân
				if (prev && prevNet !== 0 && net > 0 && !hiredInPeriod && !leftInPeriod && !hiredInPrev) {
					const diff = net - prevNet;
					const ratio = diff / Math.abs(prevNet);
					if (Math.abs(ratio) > threshold) items.push(make("NET_CHANGE", line, emp, diff, { net, prevNet, diff, ratio, threshold }));
				}

				if (prof && employment !== "C" && prof.ins_applicable !== false && prof.ins_applicable !== "F" && num(line.insurance_wage) > 0) {
					const region = prof.region || opt.defaultRegion || "";
					const min = minWageFor(opt.minInsuranceWage, region);
					if (min !== null && num(line.insurance_wage) < min) {
						items.push(make("INS_BELOW_MIN", line, emp, num(line.insurance_wage), { wage: num(line.insurance_wage), min, region: typeof opt.minInsuranceWage === "object" ? region : "", param: opt.minInsuranceParam || "" }));
					}
				}
			}
		}

		// Người có ở kỳ trước nhưng không còn dòng ở kỳ này (trừ người đã nghỉ việc trước kỳ này)
		if (hasPrev) {
			for (const l of prevLines) {
				if (!l || blank(l.employee)) continue;
				const emp = String(l.employee);
				if (seen[emp]) continue;
				seen[emp] = true;
				const prof = profiles[emp];
				const left = prof ? iso(prof.termination_date) : "";
				if (left && start && left < start) continue;
				items.push(make("NOT_IN_BATCH", null, emp, null, {}));
			}
		}

		if (period.attLocked === false) items.push(make("ATT_NOT_LOCKED", null, null, null, {}));
		return items;
	}

	// ------------------------------------------------------------------ chữ hiển thị

	function textOf(def, data, lang) {
		if (!def) return "";
		const v = def[lang === "en" ? "en" : "vi"];
		try {
			return typeof v === "function" ? String(v(data || {}, lang === "en" ? "en" : "vi")) : String(v || "");
		} catch (e) {
			return "";
		}
	}

	/** Tiêu đề, câu ngắn, mô tả và gợi ý xử lý của một cảnh báo theo ngôn ngữ ("vi" mặc định, "en"). */
	function describe(item, lang) {
		const def = RULES[item && item.rule];
		if (!def) return { title: String((item && item.rule) || ""), headline: "", description: "", hint: "" };
		const data = (item && item.data) || {};
		return { title: textOf(def.title, data, lang), headline: textOf(def.headline, data, lang), description: textOf(def.description, data, lang), hint: textOf(def.hint, data, lang) };
	}

	// ------------------------------------------------------------------ trạng thái xử lý

	// Dấu của số liệu làm phát sinh cảnh báo: số đổi (tính lại ra số khác) thì cảnh báo đã đóng được mở lại.
	// Lưu dạng băm ngắn, không lưu số tiền.
	function fingerprint(item) {
		const d = (item && item.data) || {};
		let raw = "";
		if (item && item.rule === "NET_CHANGE") raw = `${Math.round(num(d.net))}|${Math.round(num(d.prevNet))}`;
		else if (item && (item.rule === "NET_NEGATIVE" || item.rule === "NET_ZERO")) raw = String(Math.round(num(d.net)));
		else if (item && item.rule === "INS_BELOW_MIN") raw = `${Math.round(num(d.wage))}|${Math.round(num(d.min))}`;
		else if (item && item.rule === "CALC_ERROR") raw = String(d.message || "");
		else if (item && (item.rule === "LEAVER" || item.rule === "LEFT_BEFORE_PERIOD" || item.rule === "NEW_EMPLOYEE")) raw = String(d.date || d.reason || "");
		let h = 5381;
		const s = `${(item && item.key) || ""}#${raw}`;
		for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
		return h.toString(36);
	}

	/** Lỗi (error) không đóng tay được: phải sửa dữ liệu để cảnh báo tự mất. */
	function canClose(item) {
		return !!item && item.severity !== "error";
	}

	/**
	 * Ghép trạng thái đã lưu vào danh sách cảnh báo vừa tính.
	 * @param {Array} items kết quả evaluate
	 * @param {object} stored { <key>: { status, note, assignee, stamp } }
	 * @returns {Array} bản sao có thêm status, note, assignee, reopened (đã đóng nhưng số liệu đổi nên mở lại)
	 */
	function merge(items, stored) {
		const map = stored || {};
		return (items || []).map((it) => {
			const s = map[it.key] || null;
			let status = "open";
			let reopened = false;
			if (s && (s.status === "accepted" || s.status === "resolved")) {
				if (!canClose(it)) reopened = true;
				else if (!blank(s.stamp) && s.stamp !== fingerprint(it)) reopened = true;
				else status = s.status;
			}
			return Object.assign({}, it, { status, note: s && !blank(s.note) ? String(s.note) : "", assignee: s && !blank(s.assignee) ? String(s.assignee) : null, reopened });
		});
	}

	/**
	 * Số liệu cho thanh bước và thẻ số: errors = số lỗi (luôn còn mở), warnings = số cảnh báo (warn) chưa đóng,
	 * open = errors + warnings (việc còn phải xử lý trước khi duyệt; info không tính), resolved = số mục đã chấp nhận / đã xử lý.
	 */
	function counts(items) {
		const out = { open: 0, errors: 0, warnings: 0, resolved: 0 };
		for (const it of items || []) {
			const status = it.status || "open";
			if (it.severity === "error") out.errors += 1;
			else if (status !== "open") out.resolved += 1;
			else if (it.severity === "warn") out.warnings += 1;
		}
		out.open = out.errors + out.warnings;
		return out;
	}

	/** Các mục chặn duyệt bảng lương: mọi lỗi mức error, bất kể trạng thái xử lý. */
	function blocking(items) {
		return (items || []).filter((it) => it && it.severity === "error");
	}

	/** Thứ tự hiển thị: còn mở trước, rồi theo mức độ (lỗi, cảnh báo, thông tin), rồi theo tên (hoặc mã) nhân viên. */
	function sort(items, nameOf) {
		const name = (it) => String((nameOf ? nameOf(it) : it.employeeName || it.employee) || "");
		return (items || []).slice().sort((a, b) => {
			const oa = (a.status || "open") === "open" ? 0 : 1;
			const ob = (b.status || "open") === "open" ? 0 : 1;
			if (oa !== ob) return oa - ob;
			const sa = SEVERITY_ORDER[a.severity] === undefined ? 9 : SEVERITY_ORDER[a.severity];
			const sb = SEVERITY_ORDER[b.severity] === undefined ? 9 : SEVERITY_ORDER[b.severity];
			if (sa !== sb) return sa - sb;
			if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
			return name(a).localeCompare(name(b));
		});
	}

	return { RULES, STATUSES, DEFAULT_NET_CHANGE, evaluate, describe, merge, counts, blocking, sort, fingerprint, canClose };
});
