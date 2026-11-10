/**
 * Lớp bọc jsx-runtime của UIF: VDom của UIF ném lỗi "Invalid node type" (sập cả màn hình) khi phần tử con là true / false,
 * tức là kiểu viết quen tay `{điều kiện && <thẻ />}`. Lớp này đổi true / false trong children thành null trước khi gọi UIF.
 * Đồng thời tách chuỗi class nhiều lớp trên thẻ HTML thành mảng (UIF không nhận chuỗi có dấu cách).
 * tools/build_spa.mjs trỏ mọi import '@uif-js/core/jsx-runtime' về file này.
 */
import * as rt from '@uif-js/core/jsx-runtime';

const isBool = (c) => c === true || c === false;

function clean(c) {
	if (isBool(c)) return null;
	if (!Array.isArray(c)) return c;
	let changed = false;
	const out = c.map((x) => {
		const y = clean(x);
		if (y !== x) changed = true;
		return y;
	});
	return changed ? out : c;
}

function fix(type, props) {
	if (!props) return props;
	let out = props;
	if (props.children !== undefined) {
		const c = clean(props.children);
		if (c !== props.children) out = Object.assign({}, out, {children: c});
	}
	// Thẻ HTML: UIF gán class bằng classList.add nên chuỗi nhiều lớp ("a b") ném InvalidCharacterError; mảng thì được.
	// Chuỗi rỗng cũng ném lỗi ("token must not be empty"); không có lớp nào thì bỏ hẳn thuộc tính class.
	if (typeof type === 'string' && out.class !== undefined && !Array.isArray(out.class)) {
		const list = typeof out.class === 'string' ? out.class.split(/\s+/).filter(Boolean) : [];
		if (typeof out.class !== 'string' || list.length !== 1 || list[0] !== out.class) {
			out = Object.assign({}, out);
			if (list.length) out.class = list;
			else delete out.class;
		}
	}
	return out;
}

export const jsx = (type, props, key) => rt.jsx(type, fix(type, props), key);
export const jsxs = (type, props, key) => rt.jsxs(type, fix(type, props), key);
export const Fragment = rt.Fragment;
