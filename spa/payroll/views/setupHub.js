/**
 * Thiết lập (giao diện bản 2, docs/UI_V2.md). Khung chờ dựng; mở tạm màn cũ.
 */
import {pick} from '../lib/i18n.js';
import {Page, PageHeader, Card, Empty, Button} from '../ui/kit.js';

const TEXT = {
	vi: {title: 'Thiết lập', building: 'Màn hình này đang được dựng lại với giao diện mới.', openOld: 'Mở màn hình hiện tại'},
	en: {title: 'Setup', building: 'This screen is being rebuilt with the new interface.', openOld: 'Open the current screen'},
};

export default function SetupHubView({app}) {
	const t = pick(TEXT);
	return (
		<Page>
			<PageHeader title={t.title} />
			<Card>
				<Empty text={t.building} />
				<Button label={t.openOld} onClick={() => app.go('setup')} />
			</Card>
		</Page>
	);
}
