/**
 * Tính bảng lương lớn (đặc tả 5.4 giới hạn governance): reduce theo lô CHUNK dòng nhân viên, mỗi lô chỉ tính và ghi dòng
 * của chính nó (Payroll.calculate với lineIds + skipFinish, không ghi lên bản ghi bảng lương nên các lô chạy song song không
 * đụng nhau); summarize cộng tổng toàn bảng một lần, đặt trạng thái và gỡ khóa job. Bảng lương được đưa vào hàng đợi bằng
 * Payroll.markQueued (chưa tính, job = id tác vụ) nên không duyệt / ghi sổ được khi lô còn đang chạy.
 * Có lô lỗi (governance, timeout) thì dòng của lô đó còn số cũ: bảng không được coi là đã tính.
 * Tham số custscript_s4vp_mr_batch = id bảng lương.
 *
 * Ngữ cảnh tĩnh của lượt tính (kỳ, nhóm lương, thiết lập, tham số pháp lý, biểu thuế, khoản trích, loại thu nhập, quy tắc,
 * gói phúc lợi, ngày lễ, tài khoản chi phí theo đích) dựng một lần ở getInputData và nhớ N/cache theo bảng lương + id lượt
 * chạy; mỗi lô đọc lại thay cho khoảng 15 truy vấn. Cache trượt (hết hạn, bị dọn) thì lô tự dựng lại và nhớ lại: kết quả
 * tính không phụ thuộc cache. Chỉ nhớ dữ liệu thiết lập, không nhớ dòng lương.
 *
 * Cỡ lô (ước tính theo mã, đơn vị governance; SuiteQL tính 20 = runSuiteQLPaged 10 + fetch trang, dư cho chắc; submitFields
 * custom record 2; N/cache get / put 1):
 *   cố định mỗi lô  : 1 bảng lương + 1 dòng của lô + 3 hồ sơ / lịch sử lương / người phụ thuộc + 1 nhân viên + 1 nhập tay
 *                     + 1 giờ công + 1 đơn OT + 1 - 3 tạm ứng + 1 - 2 lũy kế OT (+ 2 kỳ trước nếu kỳ tuần / nửa tháng)
 *                     + 6 - 10 phiếu sản lượng + 0 - 3 giấy phép + 2 phân bổ + 0 - 2 phép còn lại = 20 - 32 truy vấn
 *                     ~ 400 - 640, cộng 2 - 4 lượt đọc cache
 *   xấu nhất thêm   : cache ngữ cảnh trượt (dựng lại ~ 16 truy vấn = 320) + bảng mã list trượt (~ 40 list = 800)
 *   mỗi dòng        : 1 lần submitFields = 2 (User Event s4vp_ue_guard bỏ qua ngữ cảnh Map/Reduce ngay dòng đầu)
 *   CHUNK = 100     : thường ~ 600 - 850, xấu nhất ~ 1.950 trên hạn mức 5.000 của reduce (dư >= 60%). Không tăng thêm: thời
 *                     gian lô lúc này chủ yếu là ghi dòng (tuyến tính theo CHUNK), lô nhỏ hơn chia đều hơn cho các
 *                     processor khi chạy song song (1.004 dòng = 11 lô); 100 x 0,1 - 0,4 giây ghi xa dưới 15 phút / lần reduce.
 *   Trước tối ưu    : mỗi lô 25 dòng đọc lại ~ 45 - 55 truy vấn, trong đó mọi dòng (kèm JSON chi tiết) của bảng lương này,
 *                     của mọi bảng lương chưa ghi sổ cùng công ty và của mọi bảng đã ghi sổ trong năm (lũy kế OT).
 * summarize ghi log số đo thật (đơn vị đã dùng lớn nhất của một lô, thời gian) để chỉnh lại CHUNK nếu cần.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(["N/runtime", "N/log", "N/cache", "../api/Payroll"], (runtime, log, cache, Payroll) => {
	const CHUNK = 100;
	const CACHE_NAME = "s4vp_calc";
	// Dài hơn một lượt tính bình thường; khóa có id lượt chạy nên lượt sau không đọc nhầm bản cũ
	const CACHE_TTL = 1800;
	// Giá trị N/cache tối đa 500 KB: cắt chuỗi JSON thành phần 120.000 ký tự (tiếng Việt UTF-8 tối đa 3 byte / ký tự = 360 KB)
	const PART_CHARS = 120000;
	const MAX_PARTS = 20;

	function batchId() {
		return String(runtime.getCurrentScript().getParameter({ name: "custscript_s4vp_mr_batch" }) || "");
	}

	function store() {
		return cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PRIVATE });
	}

	const keyOf = (id, run, part) => `c${id}_${run}_${part}`;

	/** Nhớ chuỗi ngữ cảnh tĩnh thành nhiều phần; trả số phần (0 = không nhớ được, các lô sẽ tự dựng). */
	function putStatic(id, run, json) {
		try {
			const parts = Math.ceil(json.length / PART_CHARS);
			if (!parts || parts > MAX_PARTS) return 0;
			const c = store();
			for (let i = 0; i < parts; i++) c.put({ key: keyOf(id, run, i), value: json.slice(i * PART_CHARS, (i + 1) * PART_CHARS), ttl: CACHE_TTL });
			// Phần đầu mục ghi sau cùng: lô đọc thấy đầu mục thì mọi phần đã có
			c.put({ key: keyOf(id, run, "n"), value: `${parts}:${json.length}`, ttl: CACHE_TTL });
			return parts;
		} catch (e) {
			log.error({ title: "s4vp_mr_calculate cache put", details: String((e && e.message) || e) });
			return 0;
		}
	}

	/** Đọc lại chuỗi ngữ cảnh tĩnh; thiếu phần nào / sai độ dài thì null (trượt). */
	function getStatic(id, run) {
		try {
			const c = store();
			const head = String(c.get({ key: keyOf(id, run, "n") }) || "").split(":");
			const parts = Number(head[0]);
			if (!(parts > 0) || parts > MAX_PARTS) return null;
			let json = "";
			for (let i = 0; i < parts; i++) {
				const part = c.get({ key: keyOf(id, run, i) });
				if (!part) return null;
				json += part;
			}
			return json.length === Number(head[1]) ? json : null;
		} catch (e) {
			return null;
		}
	}

	/** Ngữ cảnh tĩnh cho một lô: từ cache, trượt thì dựng lại và nhớ lại cho các lô sau. */
	function staticFor(id, run) {
		const hit = run ? getStatic(id, run) : null;
		if (hit) return { json: hit, hit: true };
		let json = null;
		try {
			json = Payroll.staticContext(id);
		} catch (e) {
			// Không dựng được (thiếu kỳ, thiếu thiết lập...): để Payroll.calculate báo đúng lỗi nghiệp vụ
			json = null;
		}
		if (json && run) putStatic(id, run, json);
		return { json, hit: false };
	}

	function getInputData() {
		const id = batchId();
		const started = Date.now();
		const ids = Payroll.lineIds(id);
		const run = Date.now().toString(36);
		let size = 0;
		let parts = 0;
		try {
			const json = Payroll.staticContext(id);
			if (json) {
				size = json.length;
				parts = putStatic(id, run, json);
			}
		} catch (e) {
			// Lỗi nghiệp vụ (kỳ đã đóng, thiếu thiết lập...) sẽ do từng lô báo qua Payroll.calculate như trước
			log.error({ title: "s4vp_mr_calculate static context", details: String((e && e.message) || e) });
		}
		const chunks = [];
		for (let i = 0; i < ids.length; i += CHUNK) chunks.push({ batch: id, run, lineIds: ids.slice(i, i + CHUNK) });
		log.audit({
			title: "s4vp_mr_calculate input",
			details: `batch ${id}: ${ids.length} line(s), ${chunks.length} chunk(s) of ${CHUNK}, static context ${size} chars in ${parts} cache part(s), ${Date.now() - started} ms, ${runtime.getCurrentScript().getRemainingUsage()} units left`,
		});
		return chunks;
	}

	function map(context) {
		// Mỗi lô một khóa riêng để reduce chạy song song từng lô
		context.write({ key: String(context.key), value: context.value });
	}

	function reduce(context) {
		const script = runtime.getCurrentScript();
		for (const value of context.values) {
			const v = JSON.parse(value);
			const started = Date.now();
			const before = script.getRemainingUsage();
			const st = staticFor(v.batch, v.run);
			const r = Payroll.calculate(v.batch, { lineIds: v.lineIds, skipFinish: true, fromJob: true, staticContext: st.json });
			// Số đo của lô (không có số tiền): số dòng, mili giây, đơn vị governance đã dùng, cache trúng hay trượt
			context.write({
				key: context.key,
				value: JSON.stringify({ errors: r.errors || [], lines: (v.lineIds || []).length, ms: Date.now() - started, used: before - script.getRemainingUsage(), hit: st.hit }),
			});
		}
	}

	function stage(s) {
		return s ? `${s.seconds || 0} s, ${s.usage || 0} units, concurrency ${s.concurrency || 0}, ${s.yields || 0} yield(s)` : "n/a";
	}

	function summarize(summary) {
		const id = batchId();
		const errors = [];
		let failedChunks = 0;
		const m = { chunks: 0, lines: 0, ms: 0, maxMs: 0, maxUsed: 0, used: 0, misses: 0 };
		summary.output.iterator().each((key, value) => {
			const o = JSON.parse(value);
			// Bản cũ ghi thẳng mảng lỗi
			const list = Array.isArray(o) ? o : o.errors || [];
			errors.push(...list);
			if (!Array.isArray(o)) {
				m.chunks++;
				m.lines += o.lines || 0;
				m.ms += o.ms || 0;
				m.used += o.used || 0;
				if ((o.ms || 0) > m.maxMs) m.maxMs = o.ms;
				if ((o.used || 0) > m.maxUsed) m.maxUsed = o.used;
				if (!o.hit) m.misses++;
			}
			return true;
		});
		const countError = (key, error) => {
			failedChunks++;
			let msg = error;
			try {
				msg = JSON.parse(error).message || error;
			} catch (e) {
				// giữ nguyên chuỗi lỗi
			}
			errors.push(String(msg));
			return true;
		};
		summary.mapSummary.errors.iterator().each(countError);
		summary.reduceSummary.errors.iterator().each(countError);
		if (summary.inputSummary.error) {
			failedChunks++;
			errors.push(String(summary.inputSummary.error));
		}
		const finishStarted = Date.now();
		try {
			Payroll.finishCalculation(id, errors, false, failedChunks);
		} finally {
			Payroll.clearJob(id);
		}
		log.audit({ title: "s4vp_mr_calculate", details: `batch ${id}: ${errors.length} error(s), ${failedChunks} failed chunk(s)` });
		// Số đo để chỉnh CHUNK / concurrency sau khi chạy thật (không ghi số tiền, không ghi định danh nhân viên)
		log.audit({
			title: "s4vp_mr_calculate timing",
			details:
				`batch ${id}: total ${summary.seconds || 0} s, ${summary.usage || 0} units, concurrency ${summary.concurrency || 0}, ${summary.yields || 0} yield(s); ` +
				`chunks ${m.chunks} (size ${CHUNK}), lines ${m.lines}; chunk time sum ${m.ms} ms, max ${m.maxMs} ms; chunk usage sum ${m.used}, max ${m.maxUsed} of 5000; ` +
				`cache misses ${m.misses}; finish ${Date.now() - finishStarted} ms; ` +
				`input [${stage(summary.inputSummary)}]; map [${stage(summary.mapSummary)}]; reduce [${stage(summary.reduceSummary)}]`,
		});
	}

	return { getInputData, map, reduce, summarize };
});
