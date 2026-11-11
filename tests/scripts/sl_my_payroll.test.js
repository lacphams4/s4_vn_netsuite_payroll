// Suitelet cổng tự phục vụ (scripts/s4vp_sl_my_payroll): định tuyến trang / JSON / PDF, chặn POST không có mã phiên của trang,
// op của POST chỉ lấy từ thân JSON. Lớp dữ liệu (core/SelfServiceOps) được thay bằng bản ghi lại lượt gọi. Không gọi NetSuite.
const path = require("path");
const ROOT = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll");

const mock = { session: {}, calls: [], printed: null, user: "101" };

jest.mock("N/file", () => ({ load: () => ({ getContents: () => "<pdf/>" }) }), { virtual: true });
jest.mock("N/render", () => ({ create: () => ({ addCustomDataSource: () => {}, renderAsPdf: () => ({}) }), DataSource: { OBJECT: "OBJECT" } }), { virtual: true });
jest.mock("N/url", () => ({ resolveScript: () => "/app/site/hosting/scriptlet.nl?script=7&deploy=1" }), { virtual: true });
jest.mock("N/log", () => ({ error: () => {}, audit: () => {} }), { virtual: true });
jest.mock(
  "N/runtime",
  () => ({
    getCurrentUser: () => ({ id: Number(mock.user), getPreference: () => "vi_VN" }),
    getCurrentSession: () => ({ get: ({ name }) => mock.session[name] || null, set: ({ name, value }) => (mock.session[name] = value) }),
  }),
  { virtual: true }
);
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Store", () => ({}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Attendance", () => ({}));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Settings", () => ({ resolve: () => ({ signers: {} }) }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/api/Clock", () => ({ today: () => "2026-11-10" }));
jest.mock("../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/core/SelfServiceOps", () => ({
  create: () => ({
    handle: (method, params, body) => {
      mock.calls.push({ method, params, body });
      if (params && params.op === "boot") return { ok: true, data: { employee: { code: "E101", name: "An" }, hasProfile: true, today: "2026-11-10" } };
      return { ok: true, data: { echo: true } };
    },
    printDetail: (batch) => {
      mock.printed = batch;
      return null;
    },
  }),
}));

const Suitelet = require(path.join(ROOT, "scripts/s4vp_sl_my_payroll"));

function call(method, parameters, body, headers) {
  const out = { written: "", headers: {} };
  const response = { write: (s) => (out.written += s), setHeader: ({ name, value }) => (out.headers[name] = value), writeFile: () => (out.file = true) };
  Suitelet.onRequest({ request: { method, parameters: parameters || {}, body: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body), headers: headers || {} }, response });
  return out;
}

beforeEach(() => {
  mock.session = {};
  mock.calls = [];
  mock.printed = null;
});

test("GET không có op: trang có mã phiên, không gọi op dữ liệu nào ngoài boot", () => {
  const r = call("GET", {});
  expect(r.written).toContain('<html lang="vi">');
  expect(mock.session.s4vp_ss_token).toBeTruthy();
  expect(r.written).toContain(mock.session.s4vp_ss_token);
  expect(mock.calls.map((c) => c.params.op)).toEqual(["boot"]);
  expect(r.headers["Cache-Control"]).toBe("no-store");
});

test("GET có op: trả JSON, chuyển nguyên tham số cho lớp kiểm quyền", () => {
  const r = call("GET", { op: "payslips", employee: "202" });
  expect(r.headers["Content-Type"]).toMatch(/application\/json/);
  expect(JSON.parse(r.written)).toEqual({ ok: true, data: { echo: true } });
  expect(mock.calls[0]).toMatchObject({ method: "GET", params: { op: "payslips", employee: "202" } });
});

test("POST không có mã phiên hoặc tiêu đề của trang: từ chối, không gọi op", () => {
  call("GET", {});
  const r = call("POST", { op: "saveRequest" }, { op: "saveRequest", token: "sai" });
  expect(JSON.parse(r.written)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  expect(mock.calls.filter((c) => c.method === "POST")).toEqual([]);
});

test("POST có mã phiên: op lấy từ thân JSON, tham số URL bị bỏ qua", () => {
  call("GET", {});
  const token = mock.session.s4vp_ss_token;
  const r = call("POST", { op: "requestAction", employee: "202" }, { op: "saveRequest", token, type: "leave", values: {} });
  expect(JSON.parse(r.written).ok).toBe(true);
  const post = mock.calls.find((c) => c.method === "POST");
  expect(post.params).toEqual({});
  expect(post.body.op).toBe("saveRequest");
});

test("POST thân không phải JSON: INVALID", () => {
  const r = call("POST", {}, "op=saveRequest", { "X-S4VP-Request": "1" });
  expect(JSON.parse(r.written)).toMatchObject({ ok: false, code: "INVALID" });
});

test("PDF: chỉ qua printDetail (lọc theo người đăng nhập); không có phiếu thì báo trên trang", () => {
  const r = call("GET", { op: "pdf", batch: "12", employee: "202" });
  expect(mock.printed).toBe("12");
  expect(r.file).toBeUndefined();
  expect(r.written).toContain("Không tìm thấy phiếu lương");
});

// Đọc dữ liệu khởi tạo nhúng trong trang (đối số của hàm client)
const bootOf = (html) => JSON.parse(/\}\)\((\{[\s\S]*\})\);<\/script>/.exec(html)[1]);

test("trang mặc định mở tab Tổng quan; view chọn tab mở đầu, giá trị lạ về Tổng quan", () => {
  expect(bootOf(call("GET", {}).written)).toMatchObject({ view: "home", embed: false });
  expect(bootOf(call("GET", { view: "requests" }).written).view).toBe("req");
  expect(bootOf(call("GET", { view: "<x>" }).written).view).toBe("home");
});

test("embed=1: bản gọn cho portlet, có địa chỉ cổng đầy đủ, vẫn chỉ gọi boot", () => {
  const b = bootOf(call("GET", { view: "dashboard", embed: "1" }).written);
  expect(b).toMatchObject({ view: "home", embed: true, fullUrl: "/app/site/hosting/scriptlet.nl?script=7&deploy=1" });
  expect(mock.calls.map((c) => c.params.op)).toEqual(["boot"]);
});
