// Portlet "Lương của tôi" (scripts/s4vp_pl_my_payroll): chạy bằng quyền người xem nên không đọc record lương, chỉ nhúng cổng tự
// phục vụ ở chế độ gọn (view=dashboard&embed=1) và nút mở cổng đầy đủ. Không gọi NetSuite.
const path = require("path");
const ROOT = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll");
const fs = require("fs");

const mock = { lang: "vi_VN", fail: false };
jest.mock("N/url", () => ({ resolveScript: () => {
  if (mock.fail) throw new Error("no deployment");
  return "/app/site/hosting/scriptlet.nl?script=7&deploy=1";
} }), { virtual: true });
jest.mock("N/runtime", () => ({ getCurrentUser: () => ({ name: 'Nguyễn "An" <b>', getPreference: () => mock.lang }) }), { virtual: true });

const Portlet = require(path.join(ROOT, "scripts/s4vp_pl_my_payroll"));

function render() {
  const portlet = {};
  Portlet.render({ portlet, column: 2 });
  return portlet;
}

test("nhúng cổng tự phục vụ bản gọn, có nút mở đầy đủ, chữ theo ngôn ngữ người dùng", () => {
  mock.lang = "vi_VN";
  const p = render();
  expect(p.title).toBe("Lương của tôi");
  expect(p.html).toContain('src="/app/site/hosting/scriptlet.nl?script=7&amp;deploy=1&amp;view=dashboard&amp;embed=1&amp;ifrmcntnr=T"');
  expect(p.html).toContain('href="/app/site/hosting/scriptlet.nl?script=7&amp;deploy=1&amp;view=dashboard"');
  expect(p.html).toContain("height:900px");
  expect(p.html).toContain("Mở đầy đủ");
  mock.lang = "en_US";
  expect(render().title).toBe("My payroll");
});

test("tên người dùng được thoát HTML; không có địa chỉ Suitelet thì chỉ báo lỗi, không có iframe", () => {
  mock.lang = "vi_VN";
  expect(render().html).toContain("Nguyễn &quot;An&quot; &lt;b&gt;");
  mock.fail = true;
  const p = render();
  mock.fail = false;
  expect(p.html).not.toContain("<iframe");
});

test("portlet không đọc dữ liệu lương: chỉ dùng N/url và N/runtime; object SDF đúng loại HTML, không có runasrole", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/s4vp_pl_my_payroll.js"), "utf8");
  expect(/define\(\["N\/url", "N\/runtime"\]/.test(src)).toBe(true);
  expect(src).toMatch(/@NScriptType Portlet/);
  const xml = fs.readFileSync(path.join(__dirname, "../../src/Objects/customscript_s4vp_pl_my_payroll.xml"), "utf8");
  expect(xml).toContain("<portlettype>HTML</portlettype>");
  expect(xml).toContain("[/SuiteScripts/com.s4.vnpayroll/scripts/s4vp_pl_my_payroll.js]");
  expect(xml).not.toContain("runasrole");
});
