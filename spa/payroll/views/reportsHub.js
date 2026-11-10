/**
 * Báo cáo - tờ khai (giao diện bản 2, docs/UI_V2.md). Khung chờ dựng; mở tạm màn cũ.
 */
import {pick} from '../lib/i18n.js';
import {Page, PageHeader, Card, Empty, Button} from '../ui/kit.js';

const TEXT = {
	vi: {title: 'Báo cáo - tờ khai', building: 'Màn hình này đang được dựng lại với giao diện mới.', openOld: 'Mở màn hình hiện tại'},
	en: {title: 'Reports - declarations', building: 'This screen is being rebuilt with the new interface.', openOld: 'Open the current screen'},
};

export default function ReportsHubView({app}) {
	const t = pick(TEXT);
	return (
		<Page>
			<PageHeader title={t.title} />
			<Card>
				<Empty text={t.building} />
				<Button label={t.openOld} onClick={() => app.go('reports')} />
			</Card>
		</Page>
	);
}
