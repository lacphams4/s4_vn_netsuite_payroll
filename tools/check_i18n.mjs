// Kiểm độ phủ đa ngôn ngữ của giao diện (spa/payroll/**/*.js), không cần NetSuite.
// Cách dùng: node tools/check_i18n.mjs [--json] [--same] [thư mục hoặc file ...]
//   --json   in kết quả dạng JSON
//   --same   in thêm (không tính lỗi) các khóa có bản en giống hệt bản vi, để rà chữ chưa dịch
// Báo lỗi (thoát mã 1) khi:
//   1. missing-en / missing-vi: một khóa (kể cả khóa con) có ở bảng vi mà thiếu ở bảng en, hoặc ngược lại.
//      Bảng chữ là mọi đối tượng có cặp khóa `vi` / `en`, và kiểu gán `X.en = Object.assign({}, X.vi, {...})`.
//   2. kind: hai bản khác loại (một bên là nhóm khóa con, bên kia là chuỗi / hàm).
//   3. vi-in-en: giá trị bản en còn ký tự có dấu tiếng Việt.
//   4. hardcoded: chuỗi / chữ JSX có dấu tiếng Việt nằm ngoài bảng vi (chú thích không tính).
// Bỏ qua một dòng có chủ ý (tên riêng, ví dụ dữ liệu): đặt chú thích `i18n-ok` trên cùng dòng.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TARGET = path.join(ROOT, "spa", "payroll");
const BASE = "vi";
const REQUIRED = ["vi", "en"];
// Chữ cái có dấu của tiếng Việt (không gồm ký hiệu như · × ∑)
const VIET = /[À-ÃÈ-ÊÌÍÒ-ÕÙÚÝà-ãè-êìíò-õùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;

function listFiles(target) {
	const st = fs.statSync(target);
	if (st.isFile()) return [target];
	const out = [];
	for (const e of fs.readdirSync(target, { withFileTypes: true })) {
		const p = path.join(target, e.name);
		if (e.isDirectory()) out.push(...listFiles(p));
		else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
	}
	return out.sort();
}

const propName = (p) => {
	const n = p.name;
	if (!n) return null;
	if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
	return null;
};

const unwrap = (node) => {
	let n = node;
	while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n))) n = n.expression;
	return n;
};

// Mọi đoạn chữ viết cứng trong một nút: chuỗi, phần tĩnh của template, chữ JSX
function textsIn(node, sf, out = []) {
	const visit = (n) => {
		if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push({ text: n.text, node: n });
		else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push({ text: n.text, node: n });
		else if (ts.isJsxText(n)) out.push({ text: n.text, node: n });
		ts.forEachChild(n, visit);
	};
	visit(node);
	return out;
}

export function analyzeSource(source, fileName = "file.js") {
	const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JSX);
	const lines = source.split(/\r?\n/);
	const issues = [];
	const same = [];
	const tables = [];
	const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
	const allowed = (line) => /i18n-ok/.test(lines[line - 1] || "");
	const add = (type, node, key, detail) => {
		const line = lineOf(node);
		if (!allowed(line)) issues.push({ type, file: fileName, line, key, detail });
	};

	// Đối tượng khai báo ở cấp file, để giải `...TEN` và `Object.assign({}, TEN, {...})`
	const consts = new Map();
	for (const st of sf.statements) {
		if (!ts.isVariableStatement(st)) continue;
		for (const d of st.declarationList.declarations) {
			const init = unwrap(d.initializer);
			if (ts.isIdentifier(d.name) && init && ts.isObjectLiteralExpression(init)) consts.set(d.name.text, init);
		}
	}

	// Cây khóa: {kind: 'group', children: Map} hoặc {kind: 'leaf', node}
	function tree(node, where) {
		const n = unwrap(node);
		if (n && ts.isIdentifier(n) && consts.has(n.text)) return tree(consts.get(n.text), where);
		if (n && ts.isCallExpression(n) && n.expression.getText(sf) === "Object.assign") {
			const out = { kind: "group", node: n, children: new Map() };
			for (const arg of n.arguments) {
				// Object.assign({}, X.vi, {...}): khóa thừa hưởng từ bảng ngôn ngữ khác không tính là đã dịch
				const a = unwrap(arg);
				if (ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.expression) && consts.has(a.expression.text) && /^[a-z]{2}$/.test(a.name.text)) continue;
				const part = tree(arg, where);
				if (part.kind !== "group") {
					add("unresolved", arg, where, "không đọc được tham số của Object.assign");
					continue;
				}
				for (const [k, v] of part.children) out.children.set(k, v);
			}
			return out;
		}
		if (!n || !ts.isObjectLiteralExpression(n)) return { kind: "leaf", node: n || node };
		const out = { kind: "group", node: n, children: new Map() };
		for (const p of n.properties) {
			if (ts.isSpreadAssignment(p)) {
				const part = tree(p.expression, where);
				if (part.kind === "group") for (const [k, v] of part.children) out.children.set(k, v);
				else add("unresolved", p, where, "không đọc được phần trải (...)");
				continue;
			}
			const name = propName(p);
			if (name === null) {
				add("unresolved", p, where, "khóa tính lúc chạy, không kiểm được");
				continue;
			}
			if (ts.isPropertyAssignment(p)) out.children.set(name, tree(p.initializer, where));
			else out.children.set(name, { kind: "leaf", node: p });
		}
		return out;
	}

	const leafText = (leaf) => (leaf.node ? leaf.node.getText(sf) : "");

	function compare(a, b, langA, langB, prefix, label) {
		for (const [k, va] of a.children) {
			const key = prefix ? `${prefix}.${k}` : k;
			const vb = b.children.get(k);
			if (!vb) {
				add(`missing-${langB}`, va.node || a.node, `${label}.${key}`, `có ở ${langA}, thiếu ở ${langB}`);
				continue;
			}
			if (va.kind !== vb.kind) {
				add("kind", vb.node || b.node, `${label}.${key}`, `${langA} là ${va.kind === "group" ? "nhóm khóa" : "giá trị"}, ${langB} là ${vb.kind === "group" ? "nhóm khóa" : "giá trị"}`);
				continue;
			}
			if (va.kind === "group") compare(va, vb, langA, langB, key, label);
			else if (langA === BASE && va.node !== vb.node && leafText(va) === leafText(vb) && /[A-Za-z]{3}/.test(leafText(va))) same.push({ file: fileName, line: lineOf(vb.node), key: `${label}.${key}`, value: leafText(vb).slice(0, 80) });
		}
	}

	function vietInOther(group, lang, prefix, label, seen) {
		for (const [k, v] of group.children) {
			const key = prefix ? `${prefix}.${k}` : k;
			if (v.kind === "group") vietInOther(v, lang, key, label, seen);
			else if (v.node && !seen.has(v.node)) {
				seen.add(v.node);
				for (const s of textsIn(v.node, sf)) if (VIET.test(s.text)) add(`vi-in-${lang}`, s.node, `${label}.${key}`, s.text.trim().slice(0, 60));
			}
		}
	}

	// Nút thuộc bảng vi (chữ Việt ở đây là hợp lệ)
	const viNodes = new Set();
	const markVi = (group) => {
		if (group.node) viNodes.add(group.node);
		for (const v of group.children.values()) {
			if (v.kind === "group") markVi(v);
			else if (v.node) viNodes.add(v.node);
		}
	};

	function checkTable(label, langs, anchor) {
		const base = langs.get(BASE);
		if (base && base.kind === "group") markVi(base);
		else if (base && base.node) viNodes.add(base.node);
		for (const lang of REQUIRED) if (!langs.has(lang)) add(`missing-${lang}`, anchor, label, `bảng chữ thiếu bản ${lang}`);
		for (const [lang, t] of langs) {
			if (lang === BASE || !base) continue;
			if (base.kind !== t.kind) {
				add("kind", t.node || anchor, label, `${BASE} và ${lang} khác loại`);
				continue;
			}
			if (t.kind === "group") {
				compare(base, t, BASE, lang, "", label);
				compare(t, base, lang, BASE, "", label);
				vietInOther(t, lang, "", label, new Set(viNodes));
			} else if (t.node) {
				for (const s of textsIn(t.node, sf)) if (VIET.test(s.text)) add(`vi-in-${lang}`, s.node, label, s.text.trim().slice(0, 60));
			}
		}
		tables.push({ file: fileName, line: lineOf(anchor), name: label, languages: [...langs.keys()], keys: base && base.kind === "group" ? countLeaves(base) : 1 });
	}

	const countLeaves = (g) => [...g.children.values()].reduce((n, v) => n + (v.kind === "group" ? countLeaves(v) : 1), 0);

	// Gán về sau: X.en = ... (ghi đè bản khai báo trong đối tượng X)
	const overrides = new Map();
	const findAssign = (n) => {
		if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && ts.isIdentifier(n.left.expression) && /^[a-z]{2}$/.test(n.left.name.text) && consts.has(n.left.expression.text)) {
			const name = n.left.expression.text;
			if (!overrides.has(name)) overrides.set(name, new Map());
			overrides.get(name).set(n.left.name.text, n.right);
		}
		ts.forEachChild(n, findAssign);
	};
	findAssign(sf);

	const describe = (node) => {
		let p = node.parent;
		if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
		if (p && ts.isPropertyAssignment(p)) return `${propName(p) || "?"}@${lineOf(node)}`;
		return `{vi,en}@${lineOf(node)}`;
	};

	// Mọi đối tượng có khóa vi hoặc en đi cùng nhau (bảng chữ của view, cặp chữ viết tại chỗ)
	const findTables = (n) => {
		if (ts.isObjectLiteralExpression(n)) {
			const names = n.properties.map(propName);
			if (names.includes("vi") || names.includes("en")) {
				const label = describe(n);
				const langs = new Map();
				for (const p of n.properties) {
					const name = propName(p);
					if (name && /^[a-z]{2}$/.test(name) && ts.isPropertyAssignment(p)) langs.set(name, tree(p.initializer, `${label}.${name}`));
				}
				const declared = n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) ? overrides.get(n.parent.name.text) : null;
				if (declared) for (const [lang, expr] of declared) langs.set(lang, tree(expr, `${label}.${lang}`));
				checkTable(label, langs, n);
			}
		}
		ts.forEachChild(n, findTables);
	};
	findTables(sf);

	// Chữ Việt viết cứng ngoài bảng vi
	const insideVi = (node) => {
		for (let p = node; p; p = p.parent) if (viNodes.has(p)) return true;
		return false;
	};
	const reported = new Set(issues.map((i) => `${i.line}:${i.detail}`));
	for (const s of textsIn(sf, sf)) {
		if (!VIET.test(s.text) || insideVi(s.node)) continue;
		const line = lineOf(s.node);
		const detail = s.text.trim().slice(0, 60);
		if (reported.has(`${line}:${detail}`)) continue;
		add("hardcoded", s.node, "", detail);
	}

	return { issues, same, tables };
}

export function analyze(targets = [DEFAULT_TARGET]) {
	const result = { files: 0, issues: [], same: [], tables: [] };
	for (const target of targets) {
		for (const file of listFiles(target)) {
			const rel = path.relative(ROOT, file).replace(/\\/g, "/");
			const r = analyzeSource(fs.readFileSync(file, "utf8"), rel);
			result.files += 1;
			result.issues.push(...r.issues);
			result.same.push(...r.same);
			result.tables.push(...r.tables);
		}
	}
	return result;
}

function main(argv) {
	const flags = argv.filter((a) => a.startsWith("--"));
	const targets = argv.filter((a) => !a.startsWith("--")).map((a) => path.resolve(a));
	const result = analyze(targets.length ? targets : [DEFAULT_TARGET]);
	if (flags.includes("--json")) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		const byType = {};
		for (const i of result.issues) {
			byType[i.type] = (byType[i.type] || 0) + 1;
			console.log(`${i.file}:${i.line}  [${i.type}]  ${i.key}${i.key && i.detail ? "  - " : ""}${i.detail || ""}`);
		}
		if (flags.includes("--same")) for (const s of result.same) console.log(`${s.file}:${s.line}  [same]  ${s.key}  = ${s.value}`);
		const keys = result.tables.reduce((n, t) => n + t.keys, 0);
		console.log(`i18n: ${result.files} file, ${result.tables.length} bảng chữ, ${keys} khóa; ${result.issues.length} lỗi${result.issues.length ? " (" + Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ") + ")" : ""}`);
	}
	process.exitCode = result.issues.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
