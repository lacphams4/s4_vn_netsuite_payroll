/**
 * Chạy lương cho một bảng lương: các bước, kiểm tra trước khi duyệt, nhân viên (mẫu docs/design/Main.dc.html). Tham số: id.
 * Bản tạm của khung: màn đang được làm lại theo giao diện bản 2 (docs/UI_V2.md); nút bên dưới mở màn hiện tại (bản cũ).
 * Phân hệ phụ trách thay toàn bộ file này.
 */
import {pick} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button} from '../ui/kit.js';

const TEXT = {
	vi: {title: 'Chạy lương', building: 'Màn hình này đang được làm lại theo giao diện mới.', openLegacy: 'Mở màn hình hiện tại'},
	en: {title: 'Run payroll', building: 'This screen is being rebuilt with the new interface.', openLegacy: 'Open the current screen'},
};

export default function PayrollRunView({app}) {
	const t = pick(TEXT);
	return (
		<Page>
			<PageHeader title={t.title} />
			<Card>
				<div>{t.building}</div>
				<div>
					<Button kind="primary" label={t.openLegacy} onClick={() => app.go('batches')} />
				</div>
			</Card>
		</Page>
	);
}
