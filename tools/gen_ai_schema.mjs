// Sinh định nghĩa MCP của bộ công cụ AI (scripts/s4vp_ct_payroll_schema.json) từ api/AiTools.TOOLS.
// Chạy: node tools/gen_ai_schema.mjs   (sau mỗi lần sửa TOOLS; test tests/api/aitools.test.js báo nếu quên)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, "src/FileCabinet/SuiteScripts/com.s4.vnpayroll");

let mod = null;
const sandbox = { define: (deps, factory) => (mod = factory({})) };
vm.runInNewContext(fs.readFileSync(path.join(base, "api/AiTools.js"), "utf8"), sandbox);
const out = path.join(base, "scripts/s4vp_ct_payroll_schema.json");
fs.writeFileSync(out, JSON.stringify(mod.schema(), null, "\t") + "\n");
console.log(`${mod.names().length} tools -> ${path.relative(root, out)}`);
