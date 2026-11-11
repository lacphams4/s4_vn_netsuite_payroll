/**
 * Sản lượng - lương khoán (giao diện bản 2, docs/UI_V2.md mục 14). Theo việc của thống kê xưởng / kế toán công trường: nhập
 * khối lượng của tổ hoặc cá nhân theo kỳ, xem tiền chia cho từng người trước khi gửi duyệt, biết phiếu nào chưa vào lương.
 * Bố cục: hàng tiêu đề (kỳ, tạo phiếu), thẻ số liệu, dải việc cần xử lý, bảng phiếu có ô tìm và chip trạng thái, khung chi
 * tiết 6:4 theo các bước (Sản lượng, Thành viên, Chia tiền, Gửi duyệt, Duyệt, Vào bảng lương), mỗi bước một nút chính.
 *
 * Đọc: GET outputsView, outputRate, outputLookups (api/OutputsV2.js), GET employeeSearch (api/AdvancesV2.js).
 * Ghi: action cũ saveOutput (phiếu + dòng + thành viên), loadTeamMembers, splitOutput, outputAction (submit / approve / hold)
 * theo ma trận quyền của RESTlet: chỉ administrator và HR; kế toán chỉ xem.
 */
import {useState, useRef, useEffect} from '@uif-js/core';
import {call, post, openRecord, errorText} from '../lib/api.js';
import {money, num, fmtDate, toNumber, localToday, fold} from '../lib/format.js';
import {pick, serverText} from '../lib/i18n.js';
import {Page, PageHeader, Card, Button, Table, Badge, Chips, StatCards, Select, AutoSelect, Field, TextInput, NumberInput, MoneyInput, DateInput, Dialog, SidePanel, SearchBox, Empty} from '../ui/kit.js';

const TEXT = {
	vi: {
		title: 'Sản lượng - lương khoán',
		sub: 'Nhập khối lượng của tổ hoặc cá nhân, xem tiền chia cho từng người, gửi duyệt. Phiếu đã duyệt tự vào bảng lương của kỳ.',
		noSubsidiary: 'Chưa chọn công ty con.',
		newEntry: 'Tạo phiếu',
		refresh: 'Tải lại',
		legacy: 'Màn hình cũ',
		loading: 'Đang tải...',
		working: 'Đang xử lý...',
		period: 'Kỳ lương',
		allPeriods: 'Tất cả kỳ',
		search: 'Tìm số, tổ, dự án, số tiền',
		empty: 'Chưa có phiếu sản lượng nào trong kỳ. Bấm Tạo phiếu để nhập.',
		emptyFilter: 'Không có phiếu nào khớp bộ lọc này.',
		total: (n) => `Tổng ${n} phiếu`,
		people: (n) => `${n} người`,
		readOnly: 'Vai trò của bạn chỉ được xem phiếu sản lượng.',
		status: {H: 'Tạm giữ', P: 'Chờ duyệt', A: 'Đã duyệt', C: 'Đã vào lương'},
		kind: {T: 'Tổ', I: 'Cá nhân', S: 'Doanh số'},
		method: {D: 'Ngày công', F: 'Ngày công x hệ số', H: 'Giờ', P: 'Tỷ lệ cố định', E: 'Chia đều'},
		chips: {all: 'Tất cả', todo: 'Cần xử lý', label: 'Lọc theo trạng thái'},
		cards: {
			pending: 'Chờ duyệt',
			pendingNote: (n) => `${n} phiếu chờ trưởng bộ phận duyệt`,
			approved: 'Đã duyệt, chưa vào lương',
			approvedNote: (n) => `${n} phiếu sẽ vào bảng lương khi tính lương`,
			total: 'Tổng tiền khoán',
			totalNote: (n, hold) => `${n} phiếu${hold ? ` - ${hold} phiếu còn tạm giữ` : ''}`,
			included: 'Đã vào bảng lương',
			includedNote: (n, batches) => `${n} phiếu${batches ? ` - ${batches}` : ''}`,
		},
		cols: {number: 'Số', date: 'Ngày', kind: 'Loại', team: 'Tổ', project: 'Dự án', table: 'Bảng đơn giá', total: 'Thành tiền', split: 'Đã chia', status: 'Trạng thái', batch: 'Bảng lương'},
		todo: {
			label: 'Cần xử lý',
			clear: 'Bỏ lọc',
			PERIOD_POSTED: 'Kỳ đã ghi sổ lương',
			SPLIT_MISMATCH: 'Tổng chia lệch',
			NOT_SPLIT: 'Tổ chưa chia',
			NO_MEMBERS: 'Chưa có thành viên',
			NO_PROFILE: 'Thiếu hồ sơ lương',
			RATE_MISSING: 'Thiếu đơn giá',
			NO_LINES: 'Chưa có sản lượng',
			NO_PERIOD: 'Chưa có kỳ',
		},
		issue: {
			PERIOD_POSTED: (batch) => `Kỳ của phiếu đã có bảng lương ghi sổ (${batch}) nhưng phiếu chưa vào lương. Chuyển phiếu sang kỳ đang mở để được trả.`,
			SPLIT_MISMATCH: (split, total) => `Tổng tiền chia ${split} khác thành tiền ${total}.`,
			NOT_SPLIT: 'Phiếu tổ chưa chia tiền cho thành viên.',
			NO_MEMBERS: 'Phiếu tổ chưa có thành viên.',
			NO_PROFILE: (names) => `Chưa có hồ sơ lương ở công ty này: ${names}. Tiền của những người này sẽ không vào bảng lương.`,
			RATE_MISSING: 'Có dòng có số lượng nhưng chưa có đơn giá.',
			NO_LINES: 'Phiếu chưa có sản lượng.',
			NO_PERIOD: 'Phiếu chưa có kỳ lương (không có kỳ nào chứa ngày phiếu).',
			fix: 'Xử lý',
		},
		steps: {label: 'Các bước của phiếu', lines: 'Sản lượng', members: 'Thành viên', split: 'Chia tiền', submit: 'Gửi duyệt', approve: 'Duyệt', payroll: 'Vào lương'},
		detail: {
			openRecord: 'Mở bản ghi',
			edit: 'Sửa phiếu',
			periodOf: (name) => `Kỳ ${name}`,
			noPeriod: 'Chưa có kỳ',
			total: 'Thành tiền',
			split: 'Đã chia',
			diff: 'Chênh lệch',
			peopleCount: 'Số người',
			method: 'Cách chia',
			description: 'Diễn giải',
			next: (step) => `Tiếp: ${step}`,
			lockedNote: 'Phiếu không còn tạm giữ nên không sửa được. Trả phiếu về tạm giữ nếu cần sửa.',
		},
		lines: {
			save: 'Lưu sản lượng',
			add: 'Thêm dòng',
			search: 'Tìm hạng mục, nhân viên, số tiền',
			employee: 'Nhân viên',
			item: 'Hạng mục',
			itemPick: 'Chọn hạng mục',
			qty: 'Số lượng',
			sales: 'Doanh số',
			rate: 'Đơn giá',
			amount: 'Thành tiền',
			uom: 'ĐVT',
			remove: 'Bỏ',
			removeOf: (name) => `Bỏ dòng ${name}`,
			itemOf: (n) => `Hạng mục dòng ${n}`,
			qtyOf: (n) => `Số lượng dòng ${n}`,
			rateOf: (n) => `Đơn giá dòng ${n}`,
			sum: 'Tổng thành tiền',
			none: 'Chưa có dòng sản lượng.',
			noneTeam: 'Chưa có dòng sản lượng. Bấm Thêm dòng để nhập hạng mục và số lượng.',
			noneIndividual: 'Chưa có dòng nào. Tìm nhân viên ở ô trên để thêm dòng.',
			rateFixed: 'Đơn giá lấy từ bảng đơn giá hiệu lực theo ngày phiếu; bảng này không cho sửa trên phiếu.',
			rateEditable: 'Đơn giá gợi ý từ bảng đơn giá hiệu lực theo ngày phiếu; sửa được trên từng dòng.',
			rateNone: 'Chưa có đơn giá hiệu lực - nhập đơn giá',
			ratesLoading: 'Đang lấy đơn giá hiệu lực...',
			ratesFailed: 'Không lấy được đơn giá gợi ý; máy chủ vẫn định giá theo bảng khi lưu.',
			salesHint: 'Bảng thang doanh số: nhập doanh số của từng người, tiền thưởng tính theo thang khi chạy lương.',
			errItem: 'Có dòng chưa chọn hạng mục.',
			errQty: 'Số lượng phải là số không âm.',
			errRate: 'Đơn giá phải là số không âm.',
			saved: (nbr) => `Đã lưu sản lượng phiếu ${nbr}.`,
			unsaved: 'Có thay đổi chưa lưu.',
		},
		find: {
			label: 'Thêm nhân viên',
			placeholder: 'Gõ mã hoặc họ tên (có dấu), bấm kết quả để thêm',
			searching: 'Đang tìm...',
			noResult: 'Không tìm thấy nhân viên có hồ sơ lương khớp.',
			more: 'Còn kết quả khác - gõ thêm để thu hẹp.',
			added: 'đã có trên phiếu',
			results: 'Kết quả tìm nhân viên',
		},
		members: {
			save: 'Lưu thành viên',
			load: 'Nạp từ tổ',
			loadFirst: 'Nạp thành viên từ tổ',
			loadDirty: 'Lưu thay đổi trước khi nạp thêm từ tổ.',
			noTeam: 'Phiếu chưa chọn tổ.',
			search: 'Tìm thành viên',
			employee: 'Thành viên',
			workDays: 'Ngày công',
			hours: 'Giờ',
			factor: 'Hệ số',
			percent: 'Tỷ lệ %',
			daysOf: (name) => `Ngày công của ${name}`,
			hoursOf: (name) => `Giờ của ${name}`,
			factorOf: (name) => `Hệ số của ${name}`,
			percentOf: (name) => `Tỷ lệ của ${name}`,
			removeOf: (name) => `Bỏ ${name} khỏi phiếu`,
			none: 'Chưa có thành viên. Nạp từ tổ hoặc tìm nhân viên để thêm.',
			noProfile: 'Chưa có hồ sơ lương',
			loaded: (n) => (n ? `Đã nạp thêm ${n} thành viên từ tổ.` : 'Không có thành viên mới: mọi thành viên hiệu lực của tổ đã có trên phiếu.'),
			saved: (nbr) => `Đã lưu thành viên phiếu ${nbr}. Kiểm tra số chia dự kiến.`,
			methodHint: 'Ngày công nạp từ bảng công của kỳ (nếu đã có); sửa được trên từng dòng.',
			errNumber: 'Ngày công, giờ, hệ số, tỷ lệ phải là số không âm.',
			percentSum: (sum) => `Tổng tỷ lệ ${sum}% (phải bằng 100%)`,
		},
		split: {
			run: 'Chia tiền',
			rerun: 'Chia lại theo cách chia',
			saveManual: 'Lưu số sửa tay',
			search: 'Tìm thành viên, số tiền',
			basis: 'Căn cứ',
			preview: 'Dự kiến chia',
			amount: 'Ghi trên phiếu',
			amountOf: (name) => `Số tiền của ${name}`,
			manual: 'sửa tay',
			sum: 'Tổng',
			ok: 'Tổng chia bằng thành tiền phiếu.',
			mismatch: (split, total, diff) => `Tổng chia ${split} khác thành tiền ${total} (lệch ${diff}). Chia lại hoặc sửa số cho khớp trước khi gửi duyệt.`,
			notYet: 'Chưa ghi số chia lên phiếu. Số dự kiến tính theo cách chia hiện tại; bấm Chia tiền để ghi, hoặc gửi duyệt để hệ thống tự chia.',
			manualNote: 'Phiếu có số sửa tay: khi gửi duyệt hệ thống không tự chia lại.',
			stale: 'Thành viên có thay đổi chưa lưu - lưu ở bước Thành viên để tính lại số dự kiến.',
			cannot: (reason) => `Chưa chia được: ${reason}`,
			basisDays: (d) => `${d} công`,
			basisDaysFactor: (d, f) => `${d} công x ${f}`,
			basisHours: (h) => `${h} giờ`,
			basisPercent: (p) => `${p}%`,
			basisEqual: 'Chia đều',
			done: (nbr) => `Đã chia tiền phiếu ${nbr}.`,
			savedManual: (nbr) => `Đã lưu số sửa tay phiếu ${nbr}.`,
			errAmount: 'Số tiền phải là số không âm.',
			noMembers: 'Phiếu chưa có thành viên để chia.',
		},
		submit: {
			run: 'Gửi duyệt',
			intro: 'Kiểm tra lần cuối rồi gửi trưởng bộ phận duyệt. Sau khi gửi, phiếu không sửa được trừ khi bị trả lại.',
			autoSplit: 'Phiếu tổ chưa có số sửa tay: hệ thống chia tiền theo cách chia ngay khi gửi.',
			sent: 'Phiếu đã được gửi duyệt.',
			blockNoLines: 'Chưa có dòng sản lượng có thành tiền.',
			blockNoMembers: 'Phiếu tổ chưa có thành viên.',
			blockSplit: 'Tổng tiền chia khác thành tiền phiếu.',
			blockNoPeriod: 'Phiếu chưa có kỳ lương.',
			blockClosed: 'Kỳ lương đã đóng.',
			blockLocked: 'Kỳ công đã khóa.',
			blockUnsaved: 'Còn thay đổi chưa lưu ở bước trước.',
			confirm: (nbr, total, people) => `Gửi duyệt phiếu ${nbr} (${total}, ${people} người)? Sau khi gửi, phiếu không sửa được trừ khi bị trả lại.`,
			done: (nbr) => `Đã gửi duyệt phiếu ${nbr}.`,
		},
		approve: {
			run: 'Duyệt',
			reject: 'Từ chối',
			waiting: 'Phiếu đang chờ duyệt. Duyệt xong, phiếu tự vào bảng lương của kỳ khi tính lương.',
			notSent: 'Phiếu chưa được gửi duyệt.',
			approvedBy: (who, date) => `Đã duyệt${date ? ` ngày ${date}` : ''}${who ? ` - ${who}` : ''}.`,
			confirm: (nbr, total, people) => `Duyệt phiếu ${nbr} (${total}, ${people} người)? Số tiền này sẽ vào bảng lương của kỳ.`,
			confirmReject: (nbr) => `Từ chối phiếu ${nbr}? Phiếu trở về Tạm giữ để người lập sửa lại.`,
			done: (nbr) => `Đã duyệt phiếu ${nbr}.`,
			rejected: (nbr) => `Đã trả phiếu ${nbr} về Tạm giữ.`,
		},
		payroll: {
			open: (nbr) => `Mở bảng lương ${nbr}`,
			goList: 'Sang chạy lương',
			hold: 'Trả về tạm giữ',
			included: (nbr) => `Phiếu đã vào bảng lương ${nbr}.`,
			waiting: (period) => `Phiếu đã duyệt, chưa vào lương. Khi tính bảng lương ${period ? `kỳ ${period}` : 'của kỳ'}, tiền khoán của từng người tự vào thu nhập; ghi sổ bảng lương thì phiếu chuyển sang Đã vào lương.`,
			notYet: 'Phiếu chỉ vào bảng lương sau khi được duyệt.',
			confirmHold: (nbr) => `Trả phiếu ${nbr} về Tạm giữ? Phiếu sẽ không vào bảng lương cho tới khi gửi duyệt và duyệt lại.`,
			held: (nbr) => `Đã trả phiếu ${nbr} về Tạm giữ.`,
		},
		form: {
			titleNew: 'Tạo phiếu sản lượng',
			titleEdit: (nbr) => `Sửa phiếu ${nbr}`,
			kind: 'Loại phiếu',
			date: 'Ngày phiếu',
			table: 'Bảng đơn giá',
			tablePick: 'Chọn bảng đơn giá',
			team: 'Tổ',
			teamPick: 'Chọn tổ',
			method: 'Cách chia tiền',
			period: 'Kỳ lương',
			periodAuto: 'Tự chọn theo ngày phiếu',
			periodHint: 'Để trống: lấy kỳ chứa ngày phiếu',
			project: 'Dự án',
			projectNone: 'Theo tổ / không gắn dự án',
			projectHint: 'Dự án quyết định đơn giá riêng và đích phân bổ chi phí',
			projectMore: 'Danh sách chỉ gồm 300 dự án đầu; dự án khác chọn trên bản ghi.',
			description: 'Diễn giải',
			create: 'Tạo và nhập sản lượng',
			save: 'Lưu phiếu',
			cancel: 'Hủy',
			errDate: 'Ngày không hợp lệ (dd/mm/yyyy).',
			errTable: 'Chưa chọn bảng đơn giá.',
			errTeam: 'Phiếu tổ phải chọn tổ.',
			noTables: 'Chưa có bảng đơn giá loại này - tạo ở Thiết lập.',
			repriced: 'Đổi ngày, bảng đơn giá hoặc dự án: đơn giá các dòng được tính lại theo bảng.',
			moreOnRecord: 'Chi nhánh, work center và các trường khác sửa trên bản ghi.',
			created: (nbr) => `Đã tạo phiếu${nbr ? ` ${nbr}` : ''}. Nhập sản lượng ở khung bên phải.`,
			saved: (nbr) => `Đã lưu phiếu ${nbr}.`,
		},
	},
	en: {
		title: 'Output - piecework pay',
		sub: 'Enter the output of a team or an employee, check the pay split per person, submit for approval. Approved entries flow into the payroll of the period.',
		noSubsidiary: 'No subsidiary selected.',
		newEntry: 'New entry',
		refresh: 'Refresh',
		legacy: 'Previous screen',
		loading: 'Loading...',
		working: 'Working...',
		period: 'Pay period',
		allPeriods: 'All periods',
		search: 'Search number, team, project, amount',
		empty: 'No output entries in this period yet. Click New entry to start.',
		emptyFilter: 'No entries match this filter.',
		total: (n) => `Total of ${n} entries`,
		people: (n) => `${n} people`,
		readOnly: 'Your role can only view output entries.',
		status: {H: 'On hold', P: 'Pending approval', A: 'Approved', C: 'In payroll'},
		kind: {T: 'Team', I: 'Individual', S: 'Sales'},
		method: {D: 'Work days', F: 'Work days x factor', H: 'Hours', P: 'Fixed percent', E: 'Equal'},
		chips: {all: 'All', todo: 'To do', label: 'Filter by status'},
		cards: {
			pending: 'Pending approval',
			pendingNote: (n) => `${n} entries waiting for the manager`,
			approved: 'Approved, not in payroll',
			approvedNote: (n) => `${n} entries will be picked up when payroll is calculated`,
			total: 'Total piecework pay',
			totalNote: (n, hold) => `${n} entries${hold ? ` - ${hold} still on hold` : ''}`,
			included: 'Included in payroll',
			includedNote: (n, batches) => `${n} entries${batches ? ` - ${batches}` : ''}`,
		},
		cols: {number: 'Number', date: 'Date', kind: 'Type', team: 'Team', project: 'Project', table: 'Rate table', total: 'Amount', split: 'Split', status: 'Status', batch: 'Payroll batch'},
		todo: {
			label: 'To do',
			clear: 'Clear filter',
			PERIOD_POSTED: 'Period already posted',
			SPLIT_MISMATCH: 'Split total differs',
			NOT_SPLIT: 'Team not split',
			NO_MEMBERS: 'No members',
			NO_PROFILE: 'Missing payroll profile',
			RATE_MISSING: 'Missing rate',
			NO_LINES: 'No output lines',
			NO_PERIOD: 'No period',
		},
		issue: {
			PERIOD_POSTED: (batch) => `The period of this entry already has a released payroll batch (${batch}) but the entry is not in payroll. Move it to an open period so it gets paid.`,
			SPLIT_MISMATCH: (split, total) => `The split total ${split} differs from the entry amount ${total}.`,
			NOT_SPLIT: 'The team entry has not been split to its members.',
			NO_MEMBERS: 'The team entry has no members.',
			NO_PROFILE: (names) => `No payroll profile in this company: ${names}. Their amounts will not reach payroll.`,
			RATE_MISSING: 'Some lines have a quantity but no rate.',
			NO_LINES: 'The entry has no output lines.',
			NO_PERIOD: 'The entry has no pay period (no period contains its date).',
			fix: 'Fix',
		},
		steps: {label: 'Entry steps', lines: 'Output', members: 'Members', split: 'Split', submit: 'Submit', approve: 'Approve', payroll: 'Payroll'},
		detail: {
			openRecord: 'Open record',
			edit: 'Edit entry',
			periodOf: (name) => `Period ${name}`,
			noPeriod: 'No period',
			total: 'Amount',
			split: 'Split',
			diff: 'Difference',
			peopleCount: 'People',
			method: 'Split method',
			description: 'Description',
			next: (step) => `Next: ${step}`,
			lockedNote: 'The entry is no longer on hold, so it cannot be changed. Put it back on hold to edit.',
		},
		lines: {
			save: 'Save output',
			add: 'Add line',
			search: 'Search item, employee, amount',
			employee: 'Employee',
			item: 'Item',
			itemPick: 'Select an item',
			qty: 'Quantity',
			sales: 'Sales',
			rate: 'Rate',
			amount: 'Amount',
			uom: 'UoM',
			remove: 'Remove',
			removeOf: (name) => `Remove line ${name}`,
			itemOf: (n) => `Item of line ${n}`,
			qtyOf: (n) => `Quantity of line ${n}`,
			rateOf: (n) => `Rate of line ${n}`,
			sum: 'Total amount',
			none: 'No output lines.',
			noneTeam: 'No output lines yet. Click Add line to enter an item and a quantity.',
			noneIndividual: 'No lines yet. Search for an employee above to add a line.',
			rateFixed: 'Rates come from the rate table effective on the entry date; this table does not allow changes on the entry.',
			rateEditable: 'Rates are suggested from the rate table effective on the entry date; you can change them per line.',
			rateNone: 'No effective rate - enter a rate',
			ratesLoading: 'Fetching effective rates...',
			ratesFailed: 'Rate suggestions could not be loaded; the server still prices by the table on save.',
			salesHint: 'Sales tier table: enter each person\'s sales; the commission is computed by tier when payroll runs.',
			errItem: 'Some lines have no item.',
			errQty: 'The quantity must be a non-negative number.',
			errRate: 'The rate must be a non-negative number.',
			saved: (nbr) => `Output of entry ${nbr} saved.`,
			unsaved: 'There are unsaved changes.',
		},
		find: {
			label: 'Add employees',
			placeholder: 'Type an ID or a name, click a result to add it',
			searching: 'Searching...',
			noResult: 'No employee with a payroll profile matches.',
			more: 'More results exist - type more to narrow down.',
			added: 'already on the entry',
			results: 'Employee search results',
		},
		members: {
			save: 'Save members',
			load: 'Load from team',
			loadFirst: 'Load members from the team',
			loadDirty: 'Save your changes before loading more members from the team.',
			noTeam: 'The entry has no team.',
			search: 'Search members',
			employee: 'Member',
			workDays: 'Work days',
			hours: 'Hours',
			factor: 'Factor',
			percent: 'Percent',
			daysOf: (name) => `Work days of ${name}`,
			hoursOf: (name) => `Hours of ${name}`,
			factorOf: (name) => `Factor of ${name}`,
			percentOf: (name) => `Percent of ${name}`,
			removeOf: (name) => `Remove ${name} from the entry`,
			none: 'No members yet. Load them from the team or search for employees to add.',
			noProfile: 'No payroll profile',
			loaded: (n) => (n ? `${n} members loaded from the team.` : 'No new members: every effective team member is already on the entry.'),
			saved: (nbr) => `Members of entry ${nbr} saved. Check the split preview.`,
			methodHint: 'Work days come from the attendance sheet of the period (when available); you can change them per row.',
			errNumber: 'Work days, hours, factor and percent must be non-negative numbers.',
			percentSum: (sum) => `Percent total ${sum}% (must be 100%)`,
		},
		split: {
			run: 'Split pay',
			rerun: 'Split again by method',
			saveManual: 'Save manual amounts',
			search: 'Search members, amounts',
			basis: 'Basis',
			preview: 'Split preview',
			amount: 'On the entry',
			amountOf: (name) => `Amount of ${name}`,
			manual: 'manual',
			sum: 'Total',
			ok: 'The split total equals the entry amount.',
			mismatch: (split, total, diff) => `The split total ${split} differs from the entry amount ${total} (difference ${diff}). Split again or fix the amounts before submitting.`,
			notYet: 'No split is saved on the entry yet. The preview uses the current method; click Split pay to save it, or submit and the system splits automatically.',
			manualNote: 'The entry has manual amounts: the system will not split again on submit.',
			stale: 'Members have unsaved changes - save them in the Members step to refresh the preview.',
			cannot: (reason) => `Cannot split yet: ${reason}`,
			basisDays: (d) => `${d} days`,
			basisDaysFactor: (d, f) => `${d} days x ${f}`,
			basisHours: (h) => `${h} hours`,
			basisPercent: (p) => `${p}%`,
			basisEqual: 'Equal share',
			done: (nbr) => `Entry ${nbr} split.`,
			savedManual: (nbr) => `Manual amounts of entry ${nbr} saved.`,
			errAmount: 'The amount must be a non-negative number.',
			noMembers: 'The entry has no members to split to.',
		},
		submit: {
			run: 'Submit for approval',
			intro: 'Do a last check, then send the entry to the manager. Once submitted it cannot be changed unless it is sent back.',
			autoSplit: 'The team entry has no manual amounts: the system splits by the method on submit.',
			sent: 'The entry has been submitted for approval.',
			blockNoLines: 'No output line with an amount.',
			blockNoMembers: 'The team entry has no members.',
			blockSplit: 'The split total differs from the entry amount.',
			blockNoPeriod: 'The entry has no pay period.',
			blockClosed: 'The pay period is closed.',
			blockLocked: 'Attendance of the period is locked.',
			blockUnsaved: 'An earlier step has unsaved changes.',
			confirm: (nbr, total, people) => `Submit entry ${nbr} (${total}, ${people} people) for approval? Once submitted it cannot be changed unless it is sent back.`,
			done: (nbr) => `Entry ${nbr} submitted for approval.`,
		},
		approve: {
			run: 'Approve',
			reject: 'Reject',
			waiting: 'The entry is waiting for approval. Once approved it flows into the payroll of the period when payroll is calculated.',
			notSent: 'The entry has not been submitted yet.',
			approvedBy: (who, date) => `Approved${date ? ` on ${date}` : ''}${who ? ` - ${who}` : ''}.`,
			confirm: (nbr, total, people) => `Approve entry ${nbr} (${total}, ${people} people)? This amount will go into the payroll of the period.`,
			confirmReject: (nbr) => `Reject entry ${nbr}? It goes back to On hold so its author can fix it.`,
			done: (nbr) => `Entry ${nbr} approved.`,
			rejected: (nbr) => `Entry ${nbr} sent back to On hold.`,
		},
		payroll: {
			open: (nbr) => `Open payroll batch ${nbr}`,
			goList: 'Go to payroll',
			hold: 'Put back on hold',
			included: (nbr) => `The entry is included in payroll batch ${nbr}.`,
			waiting: (period) => `The entry is approved and not in payroll yet. When the payroll ${period ? `of period ${period}` : 'of the period'} is calculated, each person's piecework pay is added to earnings; releasing the batch marks the entry as In payroll.`,
			notYet: 'The entry reaches payroll only after it is approved.',
			confirmHold: (nbr) => `Put entry ${nbr} back on hold? It will not reach payroll until it is submitted and approved again.`,
			held: (nbr) => `Entry ${nbr} is back on hold.`,
		},
		form: {
			titleNew: 'New output entry',
			titleEdit: (nbr) => `Edit entry ${nbr}`,
			kind: 'Entry type',
			date: 'Entry date',
			table: 'Rate table',
			tablePick: 'Select a rate table',
			team: 'Team',
			teamPick: 'Select a team',
			method: 'Split method',
			period: 'Pay period',
			periodAuto: 'Chosen by the entry date',
			periodHint: 'Leave empty to use the period containing the date',
			project: 'Project',
			projectNone: 'From the team / no project',
			projectHint: 'The project drives project rates and the cost allocation target',
			projectMore: 'Only the first 300 projects are listed; select another project on the record.',
			description: 'Description',
			create: 'Create and enter output',
			save: 'Save entry',
			cancel: 'Cancel',
			errDate: 'Invalid date (dd/mm/yyyy).',
			errTable: 'Select a rate table.',
			errTeam: 'A team entry needs a team.',
			noTables: 'No rate table of this type yet - create one in Setup.',
			repriced: 'Changing the date, rate table or project reprices the lines from the table.',
			moreOnRecord: 'Location, work center and other fields are edited on the record.',
			created: (nbr) => `Entry${nbr ? ` ${nbr}` : ''} created. Enter the output in the panel on the right.`,
			saved: (nbr) => `Entry ${nbr} saved.`,
		},
	},
};

const TONE = {H: 'muted', P: 'warn', A: 'info', C: 'ok'};
const STATUSES = ['H', 'P', 'A', 'C'];
const METHODS = ['D', 'F', 'H', 'P', 'E'];
const KINDS = ['T', 'I', 'S'];
const STEPS = {T: ['lines', 'members', 'split', 'submit', 'approve', 'payroll'], I: ['lines', 'submit', 'approve', 'payroll']};
const RECORD_TYPE = 'customrecord_s4vp_output';
const SEARCH_DELAY = 300;

const list = (v) => (Array.isArray(v) ? v : []);
const upper = (v) => String(v === null || v === undefined ? '' : v).trim().toUpperCase();
// Số đưa vào ô nhập viết theo kiểu Việt (dấu phẩy thập phân) để toNumber đọc lại đúng (1.234 sẽ bị hiểu là 1234)
const numText = (n) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));
const isBlank = (v) => String(v === null || v === undefined ? '' : v).trim() === '';
// Ô số: trống -> 0; không đọc được hoặc âm -> null (báo lỗi)
const readNumber = (v) => {
	if (isBlank(v)) return 0;
	const n = toNumber(v);
	return n === null || n < 0 ? null : n;
};
const validIso = (v) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
	if (!m) return false;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
};
const who = (x) => `${x.code || ''} ${x.name || ''}`.trim() || String(x.employee || '');

/** Bước đang chờ làm của một phiếu. */
function stepOf(r) {
	if (r.status === 'C' || r.status === 'A') return 'payroll';
	if (r.status === 'P') return 'approve';
	if (!(r.total > 0)) return 'lines';
	if (r.type === 'T') {
		if (!list(r.members).length || (r.splitError && !r.hasManual)) return 'members';
		if (r.splitTotal !== r.total) return 'split';
	}
	return 'submit';
}

/** Kỳ mặc định: kỳ chưa đóng chứa hôm nay (ưu tiên nhóm lương DEFAULT); không có thì mọi kỳ. */
function defaultPeriod(boot) {
	const today = localToday();
	const groups = list(boot.paygroups);
	const def = groups.find((g) => upper(g.code) === 'DEFAULT');
	const hits = list(boot.periods).filter((p) => p.status !== 'C' && p.start && p.end && p.start <= today && p.end >= today);
	const hit = (def && hits.find((p) => String(p.paygroup) === String(def.id))) || hits[0];
	return hit ? String(hit.id) : '';
}

export default function OutputsView({app}) {
	const t = pick(TEXT);
	const boot = app.boot || {};
	const user = boot.user || {};
	const subsidiary = app.subsidiary || '';
	const params = (app.route && app.route.params) || {};
	// Ma trận quyền của RESTlet: saveOutput, loadTeamMembers, splitOutput, outputAction chỉ cho administrator và HR
	const canWrite = user.role === 'administrator' || !!user.isHr || user.role === 'customrole_s4vp_hr';
	const periods = list(boot.periods);

	const [data, setData] = useState(null);
	const [period, setPeriod] = useState(params.period === 'all' ? '' : String(params.period || defaultPeriod(boot)));
	const [filter, setFilter] = useState('');
	const [selected, setSelected] = useState(String(params.id || ''));
	const [tab, setTab] = useState('');
	const [lookups, setLookups] = useState(null);
	const [form, setForm] = useState(null);
	const [, setDraft] = useState(null);
	const [rates, setRates] = useState({});
	const [query, setQuery] = useState('');
	const [found, setFound] = useState({items: [], more: false, state: ''});
	const [gridQuery, setGridQuery] = useState('');
	const formRef = useRef(null);
	const draftRef = useRef(null);
	const ratesRef = useRef({});
	const alive = useRef(true);
	const request = useRef(0);
	const stamp = useRef(0);
	const searchSeq = useRef(0);
	const timer = useRef(null);
	const lineSeq = useRef(0);

	const load = (per) => {
		if (!subsidiary) return Promise.resolve(null);
		request.current += 1;
		const mine = request.current;
		const p = per === undefined ? period : per;
		return app.run(t.loading, call({action: 'outputsView', subsidiary, period: p || null})).then((r) => {
			if (!alive.current || mine !== request.current || !r) return null;
			stamp.current += 1;
			draftRef.current = null;
			setData(r);
			return r;
		});
	};

	useEffect(() => {
		alive.current = true;
		load();
		return () => {
			alive.current = false;
			if (timer.current) clearTimeout(timer.current);
		};
	}, [subsidiary, period]);

	const view = data || {};
	const counts = view.counts || {};
	const cards = view.cards || {};
	const all = list(view.rows);
	const current = selected ? all.find((r) => String(r.id) === String(selected)) || null : null;

	// Đơn giá hiệu lực của bảng đơn giá tại ngày phiếu (và dự án): lấy một lần cho mỗi bộ (bảng, ngày, dự án) khi mở phiếu tạm giữ
	const rateKey = current && current.status === 'H' && current.rateTable && current.date ? `${current.rateTable}|${current.date}|${current.project || ''}` : '';
	useEffect(() => {
		if (!rateKey || ratesRef.current[rateKey]) return;
		const [rateTable, date, project] = rateKey.split('|');
		const put = (v) => {
			ratesRef.current = Object.assign({}, ratesRef.current, {[rateKey]: v});
			if (alive.current) setRates(ratesRef.current);
		};
		put({state: 'loading', items: []});
		call({action: 'outputRate', rateTable, date, project: project || null}).then(
			(r) => put({state: 'ok', items: list(r && r.items)}),
			() => put({state: 'error', items: []})
		);
	}, [rateKey]);

	// ------------------------------------------------------------------ gọi máy chủ
	const send = (body) =>
		post(body).then((r) => {
			// Lỗi phân quyền của action cũ có thể trả ở khóa error / errorVi (không ném)
			if (r && r.error) throw {message: serverText(r.error, r.errorVi)};
			return r || {ok: true};
		});
	/** Chạy một action ghi, nạp lại dữ liệu rồi báo kết quả; after(r, dữ liệu mới) chạy trước thông báo. */
	const act = (body, doneText, after) =>
		app.run(t.working, send(body)).then((r) => {
			if (!r || !alive.current) return;
			load().then((fresh) => {
				if (!alive.current) return;
				if (after) after(r, fresh);
				const warnings = list(r.warnings).map((w) => serverText(w.message, w.messageVi)).filter(Boolean);
				if (warnings.length) app.notify(warnings.join(' '), 'warn');
				else if (doneText) app.notify(typeof doneText === 'function' ? doneText(r) : doneText, 'ok');
			});
		});
	const ensureLookups = () => {
		if (lookups && lookups.subsidiary === subsidiary) return Promise.resolve(lookups);
		return app.run(t.loading, call({action: 'outputLookups', subsidiary})).then((r) => {
			if (!r || !alive.current) return null;
			const v = Object.assign({}, r, {subsidiary});
			setLookups(v);
			return v;
		});
	};

	const pickEntry = (id, step) => {
		setSelected(String(id || ''));
		setTab(step || '');
		setQuery('');
		setGridQuery('');
		setFound({items: [], more: false, state: ''});
	};
	const pickTab = (step) => {
		setTab(step);
		setQuery('');
		setGridQuery('');
		setFound({items: [], more: false, state: ''});
	};

	// ------------------------------------------------------------------ bản nháp đang sửa của phiếu đang mở
	const seed = (r) => ({
		id: r.id,
		stamp: stamp.current,
		method: r.splitMethod || 'F',
		lines: list(r.lines).map((l) => ({key: `l${l.id}`, employee: l.employee || '', code: l.code || '', name: l.name || '', item: l.item || '', description: l.description || '', uom: l.uom || '', qty: numText(l.qty), rate: numText(l.rate), noProfile: !!l.noProfile})),
		members: list(r.members).map((m) => ({employee: String(m.employee), code: m.code || '', name: m.name || '', workDays: numText(m.workDays), hours: numText(m.hours), factor: numText(m.factor), percent: numText(m.percent), amount: Number(m.amount) || 0, amountText: numText(Number(m.amount) || 0), manual: !!m.manual, edited: false, noProfile: !!m.noProfile, preview: m.preview})),
		linesDirty: false,
		membersDirty: false,
		amountsDirty: false,
		error: '',
	});
	const draftOf = (r) => (draftRef.current && draftRef.current.id === r.id && draftRef.current.stamp === stamp.current ? draftRef.current : seed(r));
	const putDraft = (r, patch) => {
		draftRef.current = Object.assign({}, draftOf(r), {error: ''}, patch);
		setDraft(draftRef.current);
	};

	// ------------------------------------------------------------------ tìm nhân viên phía máy chủ
	const search = (text) => {
		setQuery(text);
		if (timer.current) clearTimeout(timer.current);
		searchSeq.current += 1;
		const mine = searchSeq.current;
		const q = String(text || '').trim();
		if (!q) {
			setFound({items: [], more: false, state: ''});
			return;
		}
		setFound({items: found.items, more: false, state: 'searching'});
		timer.current = setTimeout(() => {
			call({action: 'employeeSearch', subsidiary, q}).then(
				(r) => {
					if (!alive.current || mine !== searchSeq.current) return;
					const items = list(r && r.items);
					setFound({items, more: !!(r && r.more), state: items.length ? '' : 'none'});
				},
				(e) => {
					if (!alive.current || mine !== searchSeq.current) return;
					setFound({items: [], more: false, state: 'error', error: errorText(e)});
				}
			);
		}, SEARCH_DELAY);
	};
	const finder = (onAdd, addedIds) => (
		<div class="s4vp-out-find">
			<TextInput type="search" value={query} onInput={search} placeholder={t.find.placeholder} ariaLabel={t.find.label} onEnter={() => found.items[0] && onAdd(found.items[0])} />
			{query.trim() ? (
				<div class="s4vp-out-results" role="group" aria-label={t.find.results}>
					{found.items.map((e) => {
						const added = addedIds.indexOf(String(e.id)) >= 0;
						const a = {type: 'button', class: 's4vp-out-result'};
						if (added) a.disabled = 'disabled';
						else a.onClick = () => onAdd(e);
						return (
							<button key={`e${e.id}`} {...a}>
								<span class="s4vp-out-who-n">{`${e.code || ''} ${e.name || ''}`.trim()}</span>
								<span class="s4vp-small">{[e.department, added ? t.find.added : ''].filter(Boolean).join(' · ')}</span>
							</button>
						);
					})}
					{found.state === 'searching' && !found.items.length ? <div class="s4vp-out-hint">{t.find.searching}</div> : null}
					{found.state === 'none' ? <div class="s4vp-out-hint">{t.find.noResult}</div> : null}
					{found.state === 'error' ? <div class="s4vp-out-hint s4vp-out-err">{found.error || t.find.noResult}</div> : null}
					{found.more ? <div class="s4vp-out-hint">{t.find.more}</div> : null}
				</div>
			) : null}
		</div>
	);
	const matches = (texts) => {
		const words = fold(gridQuery).split(/\s+/).filter(Boolean);
		if (!words.length) return true;
		const hay = fold(texts.filter((x) => x !== null && x !== undefined).join(' '));
		return words.every((w) => hay.indexOf(w) >= 0);
	};

	// ------------------------------------------------------------------ bước 1: sản lượng
	const rateState = (r) => rates[`${r.rateTable}|${r.date}|${r.project || ''}`] || {state: 'loading', items: []};
	const linesModel = (r) => {
		const d = draftOf(r);
		const rs = rateState(r);
		const byItem = {};
		rs.items.forEach((it) => (byItem[upper(it.item)] = it));
		const sales = r.kind === 'S';
		const rows = d.lines.map((l) => {
			const hit = byItem[upper(l.item)] || null;
			const suggested = hit && hit.rate !== null && hit.rate !== undefined ? Number(hit.rate) : null;
			// Sửa đơn giá khi bảng cho sửa hoặc chưa có đơn giá hiệu lực (đúng quy tắc định giá của máy chủ); chưa lấy được gợi ý thì cho nhập
			const editable = !sales && (r.allowOverride || suggested === null || rs.state !== 'ok');
			const typed = isBlank(l.rate) ? null : toNumber(l.rate);
			const rate = sales ? 1 : editable && typed !== null ? typed : suggested === null ? typed || 0 : suggested;
			const qty = toNumber(l.qty) || 0;
			return Object.assign({}, l, {suggested, editable, effRate: rate, amount: Math.round(qty * rate)});
		});
		return {d, rs, sales, rows, items: rs.items, total: rows.reduce((s, l) => s + l.amount, 0)};
	};
	const setLine = (r, key, patch) => putDraft(r, {lines: draftOf(r).lines.map((l) => (l.key === key ? Object.assign({}, l, patch) : l)), linesDirty: true});
	const addLine = (r, e) => {
		lineSeq.current += 1;
		const base = {key: `n${lineSeq.current}`, employee: '', code: '', name: '', item: '', description: '', uom: '', qty: '', rate: '', noProfile: false};
		putDraft(r, {lines: draftOf(r).lines.concat([e ? Object.assign(base, {employee: String(e.id), code: e.code || '', name: e.name || ''}) : base]), linesDirty: true});
	};
	const removeLine = (r, key) => putDraft(r, {lines: draftOf(r).lines.filter((l) => l.key !== key), linesDirty: true});
	const pickItem = (r, key, code) => {
		const hit = rateState(r).items.find((it) => upper(it.item) === upper(code));
		setLine(r, key, {item: code, description: hit ? hit.description || '' : '', uom: hit ? hit.uom || '' : '', rate: hit && hit.rate !== null && hit.rate !== undefined ? numText(hit.rate) : ''});
	};
	const saveLines = (r) => {
		const m = linesModel(r);
		const used = m.rows.filter((l) => l.employee || l.item || !isBlank(l.qty));
		let error = '';
		if (!m.sales && used.some((l) => !l.item)) error = t.lines.errItem;
		else if (used.some((l) => readNumber(l.qty) === null)) error = t.lines.errQty;
		else if (used.some((l) => l.editable && readNumber(l.rate) === null)) error = t.lines.errRate;
		if (error) {
			putDraft(r, {error});
			return;
		}
		const lines = used.map((l) => ({employee: l.employee || null, item: l.item || '', description: l.description || '', uom: l.uom || '', qty: readNumber(l.qty), rate: l.editable && !isBlank(l.rate) ? readNumber(l.rate) : ''}));
		act({action: 'saveOutput', values: {id: r.id}, lines}, t.lines.saved(r.name), () => setTab(''));
	};
	const nextOf = (r, step) => {
		const keys = STEPS[r.type] || STEPS.I;
		return keys[keys.indexOf(step) + 1] || '';
	};
	const nextButton = (r, step) => {
		const next = nextOf(r, step);
		return <Button label={t.detail.next(t.steps[next])} kind="primary" onClick={() => pickTab(next)} />;
	};
	const linesStep = (r, editable) => {
		if (!editable) {
			const rows = list(r.lines).map((l) => Object.assign({}, l, {itemText: [l.item, l.description].filter(Boolean).join(' - '), whoText: who(l)}));
			return (
				<div class="s4vp-out-box">
					{rows.length ? (
						<Table
							label={t.steps.lines}
							columns={[
								r.type === 'I' ? {key: 'whoText', label: t.lines.employee} : null,
								r.kind === 'S' ? null : {key: 'itemText', label: t.lines.item},
								{key: 'qty', label: r.kind === 'S' ? t.lines.sales : t.lines.qty, type: 'num', nowrap: true},
								r.kind === 'S' ? null : {key: 'rate', label: t.lines.rate, type: 'num', nowrap: true},
								{key: 'amount', label: t.lines.amount, type: 'money', nowrap: true},
							].filter(Boolean)}
							rows={rows}
							keyOf={(l) => l.id}
							total={rows.length > 1 ? {whoText: t.lines.sum, itemText: r.type === 'I' ? '' : t.lines.sum, amount: r.total} : null}
							search={true}
							searchPlaceholder={t.lines.search}
						/>
					) : (
						<Empty text={t.lines.none} />
					)}
				</div>
			);
		}
		const m = linesModel(r);
		const shown = m.rows.filter((l) => matches([l.code, l.name, l.item, l.description, l.amount, money(l.amount)]));
		const itemOptions = (l) => {
			const options = m.items.map((it) => ({value: it.item, label: [it.item, it.description].filter(Boolean).join(' - ')}));
			if (l.item && !options.some((o) => upper(o.value) === upper(l.item))) options.push({value: l.item, label: [l.item, l.description].filter(Boolean).join(' - ')});
			return options;
		};
		const individual = r.type === 'I';
		const hint = m.sales ? t.lines.salesHint : m.rs.state === 'loading' ? t.lines.ratesLoading : m.rs.state === 'error' ? t.lines.ratesFailed : r.allowOverride ? t.lines.rateEditable : t.lines.rateFixed;
		return (
			<div class="s4vp-out-body">
				<div class="s4vp-out-acts">
					{m.d.linesDirty || !(r.total > 0) ? (
						<Button label={t.lines.save} kind="primary" disabled={!m.d.linesDirty || m.rs.state === 'loading' || !!app.busy} onClick={() => saveLines(r)} />
					) : (
						nextButton(r, 'lines')
					)}
					{individual ? null : <Button label={t.lines.add} onClick={() => addLine(r, null)} />}
					{m.d.linesDirty ? <span class="s4vp-out-dirty">{t.lines.unsaved}</span> : null}
					<span class="s4vp-out-sum">{`${t.lines.sum}: ${money(m.total) === '-' ? '0' : money(m.total)}`}</span>
				</div>
				{m.d.error ? <div class="s4vp-out-warn s4vp-out-err" role="alert">{m.d.error}</div> : null}
				{individual ? finder((e) => addLine(r, e), []) : null}
				<div class="s4vp-out-bar">
					<span class="s4vp-small">{hint}</span>
					<SearchBox value={gridQuery} onInput={setGridQuery} placeholder={t.lines.search} width={200} />
				</div>
				<div class="s4vp-out-grid">
					<table class="s4vp-tbl" aria-label={t.steps.lines}>
						<thead>
							<tr>
								{individual ? <th>{t.lines.employee}</th> : null}
								{m.sales ? null : <th>{t.lines.item}</th>}
								<th class="s4vp-r">{m.sales ? t.lines.sales : t.lines.qty}</th>
								{m.sales ? null : <th class="s4vp-r">{t.lines.rate}</th>}
								<th class="s4vp-r">{t.lines.amount}</th>
								<th>{''}</th>
							</tr>
						</thead>
						<tbody>
							{shown.map((l) => {
								const n = m.rows.indexOf(l) + 1;
								const label = individual ? who(l) : l.item || String(n);
								return (
									<tr key={l.key}>
										{individual ? (
											<td>
												<span class="s4vp-out-who">
													<span class="s4vp-out-who-n">{l.name || l.code}</span>
													<span class="s4vp-small">{l.noProfile ? `${l.code} · ${t.members.noProfile}` : l.code}</span>
												</span>
											</td>
										) : null}
										{m.sales ? null : (
											<td>
												<AutoSelect value={l.item} onInput={(v) => pickItem(r, l.key, v)} options={itemOptions(l)} placeholder={t.lines.itemPick} ariaLabel={t.lines.itemOf(n)} width={individual ? 130 : 190} />
												{l.uom ? <span class="s4vp-small s4vp-out-uom">{`${t.lines.uom}: ${l.uom}`}</span> : null}
											</td>
										)}
										<td class="s4vp-r">
											<NumberInput value={l.qty} onInput={(v) => setLine(r, l.key, {qty: v})} ariaLabel={t.lines.qtyOf(n)} width={m.sales ? 140 : 84} />
										</td>
										{m.sales ? null : (
											<td class="s4vp-r">
												{l.editable ? (
													<MoneyInput value={l.rate} onInput={(v) => setLine(r, l.key, {rate: v})} ariaLabel={t.lines.rateOf(n)} width={100} placeholder={l.suggested === null ? '' : num(l.suggested)} title={l.item && l.suggested === null && m.rs.state === 'ok' ? t.lines.rateNone : ''} />
												) : (
													<span class="s4vp-out-fixed">{num(l.effRate)}</span>
												)}
											</td>
										)}
										<td class="s4vp-r s4vp-nw">{money(l.amount)}</td>
										<td class="s4vp-r">
											<Button small={true} kind="ghost" label={t.lines.remove} ariaLabel={t.lines.removeOf(label)} onClick={() => removeLine(r, l.key)} />
										</td>
									</tr>
								);
							})}
							{m.rows.length ? null : (
								<tr key="none">
									<td colSpan="6">
										<div class="s4vp-empty">{individual ? t.lines.noneIndividual : t.lines.noneTeam}</div>
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		);
	};

	// ------------------------------------------------------------------ bước 2: thành viên
	const setMember = (r, emp, patch, dirty) => putDraft(r, Object.assign({members: draftOf(r).members.map((m) => (m.employee === emp ? Object.assign({}, m, patch) : m))}, dirty));
	const addMember = (r, e) => {
		const d = draftOf(r);
		if (!e || d.members.some((m) => m.employee === String(e.id))) return;
		putDraft(r, {members: d.members.concat([{employee: String(e.id), code: e.code || '', name: e.name || '', workDays: '', hours: '', factor: '1', percent: '', amount: 0, amountText: '0', manual: false, edited: false, noProfile: false, preview: null}]), membersDirty: true});
	};
	const removeMember = (r, emp) => putDraft(r, {members: draftOf(r).members.filter((m) => m.employee !== emp), membersDirty: true});
	/** Dòng thành viên gửi cho saveOutput (thay toàn bộ); resetAuto: số chia tự động đặt về 0 để tính lại sau khi đổi căn cứ. */
	const memberPayload = (d, resetAuto) => {
		const out = [];
		for (const m of d.members) {
			const v = {employee: m.employee, work_days: readNumber(m.workDays), hours: readNumber(m.hours), factor: isBlank(m.factor) ? 1 : readNumber(m.factor), percent: readNumber(m.percent)};
			if (v.work_days === null || v.hours === null || v.factor === null || v.percent === null) return {error: t.members.errNumber};
			const typed = readNumber(m.amountText);
			if (typed === null) return {error: t.split.errAmount};
			const manual = m.manual || m.edited;
			out.push(Object.assign(v, {amount: manual ? Math.round(typed) : resetAuto ? 0 : m.amount, manual}));
		}
		return {members: out};
	};
	const saveMembers = (r) => {
		const d = draftOf(r);
		const p = memberPayload(d, true);
		if (p.error) {
			putDraft(r, {error: p.error});
			return;
		}
		act({action: 'saveOutput', values: {id: r.id, split_method: d.method}, members: p.members}, t.members.saved(r.name), () => setTab('split'));
	};
	const loadTeam = (r) => act({action: 'loadTeamMembers', id: r.id}, (res) => t.members.loaded(list(res.added).length), () => setTab('members'));
	const methodColumns = (method) => ({days: method === 'D' || method === 'F', factor: method === 'F', hours: method === 'H', percent: method === 'P'});
	const basisText = (m, method) => {
		if (method === 'D') return t.split.basisDays(num(toNumber(m.workDays) || 0));
		if (method === 'H') return t.split.basisHours(num(toNumber(m.hours) || 0));
		if (method === 'P') return t.split.basisPercent(num(toNumber(m.percent) || 0));
		if (method === 'E') return t.split.basisEqual;
		return t.split.basisDaysFactor(num(toNumber(m.workDays) || 0), num(isBlank(m.factor) ? 1 : toNumber(m.factor) || 0));
	};
	const personCell = (m) => (
		<span class="s4vp-out-who">
			<span class="s4vp-out-who-n">{m.name || m.code}</span>
			<span class="s4vp-small">{m.code}</span>
			{m.noProfile ? <Badge text={t.members.noProfile} tone="warn" /> : null}
		</span>
	);
	const membersStep = (r, editable) => {
		const d = draftOf(r);
		const method = editable ? d.method : r.splitMethod || 'F';
		const cols = methodColumns(method);
		if (!editable) {
			const rows = list(r.members).map((m) => Object.assign({}, m, {whoText: who(m), flag: m.noProfile ? t.members.noProfile : ''}));
			return (
				<div class="s4vp-out-box">
					{rows.length ? (
						<Table
							label={t.steps.members}
							columns={[
								{key: 'whoText', label: t.members.employee, render: (m) => personCell(m)},
								cols.days ? {key: 'workDays', label: t.members.workDays, type: 'num', nowrap: true} : null,
								cols.hours ? {key: 'hours', label: t.members.hours, type: 'num', nowrap: true} : null,
								cols.factor ? {key: 'factor', label: t.members.factor, type: 'num', nowrap: true} : null,
								cols.percent ? {key: 'percent', label: t.members.percent, type: 'num', nowrap: true} : null,
								{key: 'amount', label: t.split.amount, type: 'money', nowrap: true},
							].filter(Boolean)}
							rows={rows}
							keyOf={(m) => m.employee}
							total={rows.length > 1 ? {whoText: t.split.sum, amount: r.splitTotal} : null}
							search={true}
							searchPlaceholder={t.members.search}
						/>
					) : (
						<Empty text={t.split.noMembers} />
					)}
				</div>
			);
		}
		const shown = d.members.filter((m) => matches([m.code, m.name]));
		const percentSum = d.members.reduce((s, m) => s + (toNumber(m.percent) || 0), 0);
		const canLoad = !!r.team && !d.membersDirty;
		let primary;
		if (d.membersDirty) primary = <Button label={t.members.save} kind="primary" disabled={!!app.busy} onClick={() => saveMembers(r)} />;
		else if (!d.members.length) primary = <Button label={t.members.loadFirst} kind="primary" disabled={!r.team || !!app.busy} title={r.team ? '' : t.members.noTeam} onClick={() => loadTeam(r)} />;
		else primary = nextButton(r, 'members');
		return (
			<div class="s4vp-out-body">
				<div class="s4vp-out-acts">
					{primary}
					{d.members.length ? <Button label={t.members.load} disabled={!canLoad || !!app.busy} title={!r.team ? t.members.noTeam : d.membersDirty ? t.members.loadDirty : ''} onClick={() => loadTeam(r)} /> : null}
					<span class="s4vp-out-method">
						<Select value={d.method} onInput={(v) => putDraft(r, {method: v || 'F', membersDirty: true})} options={METHODS.map((k) => ({value: k, label: t.method[k]}))} ariaLabel={t.detail.method} width={178} />
					</span>
					{d.membersDirty ? <span class="s4vp-out-dirty">{t.lines.unsaved}</span> : null}
				</div>
				{d.error ? <div class="s4vp-out-warn s4vp-out-err" role="alert">{d.error}</div> : null}
				{r.splitError && !d.membersDirty ? <div class="s4vp-out-warn" role="note">{t.split.cannot(serverText(r.splitError.en, r.splitError.vi))}</div> : null}
				{method === 'P' && d.members.length && Math.abs(percentSum - 100) > 0.000001 ? <div class="s4vp-out-warn" role="note">{t.members.percentSum(num(percentSum))}</div> : null}
				{finder((e) => addMember(r, e), d.members.map((m) => m.employee))}
				<div class="s4vp-out-bar">
					<span class="s4vp-small">{cols.days ? t.members.methodHint : ''}</span>
					<SearchBox value={gridQuery} onInput={setGridQuery} placeholder={t.members.search} width={200} />
				</div>
				<div class="s4vp-out-grid">
					<table class="s4vp-tbl" aria-label={t.steps.members}>
						<thead>
							<tr>
								<th>{t.members.employee}</th>
								{cols.days ? <th class="s4vp-r">{t.members.workDays}</th> : null}
								{cols.hours ? <th class="s4vp-r">{t.members.hours}</th> : null}
								{cols.factor ? <th class="s4vp-r">{t.members.factor}</th> : null}
								{cols.percent ? <th class="s4vp-r">{t.members.percent}</th> : null}
								<th>{''}</th>
							</tr>
						</thead>
						<tbody>
							{shown.map((m) => {
								const label = who(m);
								const dirty = {membersDirty: true};
								return (
									<tr key={`m${m.employee}`}>
										<td>{personCell(m)}</td>
										{cols.days ? <td class="s4vp-r"><NumberInput value={m.workDays} onInput={(v) => setMember(r, m.employee, {workDays: v}, dirty)} ariaLabel={t.members.daysOf(label)} width={84} /></td> : null}
										{cols.hours ? <td class="s4vp-r"><NumberInput value={m.hours} onInput={(v) => setMember(r, m.employee, {hours: v}, dirty)} ariaLabel={t.members.hoursOf(label)} width={84} /></td> : null}
										{cols.factor ? <td class="s4vp-r"><NumberInput value={m.factor} onInput={(v) => setMember(r, m.employee, {factor: v}, dirty)} ariaLabel={t.members.factorOf(label)} width={76} /></td> : null}
										{cols.percent ? <td class="s4vp-r"><NumberInput value={m.percent} onInput={(v) => setMember(r, m.employee, {percent: v}, dirty)} ariaLabel={t.members.percentOf(label)} width={84} /></td> : null}
										<td class="s4vp-r">
											<Button small={true} kind="ghost" label={t.lines.remove} ariaLabel={t.members.removeOf(label)} onClick={() => removeMember(r, m.employee)} />
										</td>
									</tr>
								);
							})}
							{d.members.length ? null : (
								<tr key="none">
									<td colSpan="6">
										<div class="s4vp-empty">{t.members.none}</div>
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		);
	};

	// ------------------------------------------------------------------ bước 3: chia tiền
	const saveManual = (r) => {
		const p = memberPayload(draftOf(r), false);
		if (p.error) {
			putDraft(r, {error: p.error});
			return;
		}
		act({action: 'saveOutput', values: {id: r.id}, members: p.members}, t.split.savedManual(r.name), () => setTab('split'));
	};
	const runSplit = (r) => act({action: 'splitOutput', id: r.id}, t.split.done(r.name), () => setTab(''));
	const splitStep = (r, editable) => {
		const d = draftOf(r);
		const method = r.splitMethod || 'F';
		const members = editable ? d.members : list(r.members).map((m) => Object.assign({}, m, {employee: String(m.employee), workDays: numText(m.workDays), hours: numText(m.hours), factor: numText(m.factor), percent: numText(m.percent), amountText: numText(m.amount), edited: false}));
		if (!members.length) return <Empty text={t.split.noMembers} />;
		const amountOf = (m) => (editable ? Math.round(toNumber(m.amountText) || 0) : Number(m.amount) || 0);
		const saved = members.reduce((s, m) => s + amountOf(m), 0);
		const hasPreview = members.some((m) => m.preview !== null && m.preview !== undefined);
		const previewSum = members.reduce((s, m) => s + (Number(m.preview) || 0), 0);
		const anyManual = members.some((m) => m.manual || m.edited);
		const diff = saved - r.total;
		const shown = members.filter((m) => matches([m.code, m.name, amountOf(m), money(amountOf(m)), m.preview]));
		let primary = null;
		if (editable) {
			if (d.amountsDirty) primary = <Button label={t.split.saveManual} kind="primary" disabled={!!app.busy} onClick={() => saveManual(r)} />;
			else if (diff !== 0 || !(r.total > 0)) primary = <Button label={t.split.run} kind="primary" disabled={d.membersDirty || !!r.splitError || !(r.total > 0) || !!app.busy} title={d.membersDirty ? t.split.stale : ''} onClick={() => runSplit(r)} />;
			else primary = nextButton(r, 'split');
		}
		let note;
		if (editable && d.membersDirty) note = <div class="s4vp-out-warn" role="note">{t.split.stale}</div>;
		else if (r.splitError && editable) note = <div class="s4vp-out-warn" role="note">{t.split.cannot(serverText(r.splitError.en, r.splitError.vi))}</div>;
		else if (diff === 0) note = <div class="s4vp-out-okay" role="note">{anyManual ? `${t.split.ok} ${t.split.manualNote}` : t.split.ok}</div>;
		else if (saved === 0 && !anyManual) note = <div class="s4vp-out-warn" role="note">{t.split.notYet}</div>;
		else note = <div class="s4vp-out-warn" role="alert">{`${t.split.mismatch(money(saved), money(r.total), money(Math.abs(diff)))}${anyManual ? ` ${t.split.manualNote}` : ''}`}</div>;
		return (
			<div class="s4vp-out-body">
				{editable ? (
					<div class="s4vp-out-acts">
						{primary}
						{!d.amountsDirty && diff === 0 && r.total > 0 ? <Button label={t.split.rerun} disabled={d.membersDirty || !!r.splitError || !!app.busy} onClick={() => runSplit(r)} /> : null}
						{d.amountsDirty ? <span class="s4vp-out-dirty">{t.lines.unsaved}</span> : null}
					</div>
				) : null}
				{d.error && editable ? <div class="s4vp-out-warn s4vp-out-err" role="alert">{d.error}</div> : null}
				{note}
				<div class="s4vp-out-bar">
					<span class="s4vp-small">{`${t.detail.method}: ${t.method[method] || method}`}</span>
					<SearchBox value={gridQuery} onInput={setGridQuery} placeholder={t.split.search} width={200} />
				</div>
				<div class="s4vp-out-grid">
					<table class="s4vp-tbl" aria-label={t.steps.split}>
						<thead>
							<tr>
								<th>{t.members.employee}</th>
								<th>{t.split.basis}</th>
								{hasPreview ? <th class="s4vp-r">{t.split.preview}</th> : null}
								<th class="s4vp-r">{t.split.amount}</th>
							</tr>
						</thead>
						<tbody>
							{shown.map((m) => (
								<tr key={`s${m.employee}`}>
									<td>{personCell(m)}</td>
									<td class="s4vp-nw s4vp-small">{basisText(m, method)}</td>
									{hasPreview ? <td class="s4vp-r s4vp-nw">{m.preview === null || m.preview === undefined ? '' : money(m.preview)}</td> : null}
									<td class="s4vp-r s4vp-nw">
										{editable ? (
											<MoneyInput value={m.amountText} decimals={0} onInput={(v) => setMember(r, m.employee, {amountText: v, edited: true}, {amountsDirty: true})} ariaLabel={t.split.amountOf(who(m))} width={124} />
										) : (
											money(m.amount)
										)}
										{m.manual || m.edited ? <span class="s4vp-small s4vp-out-uom">{t.split.manual}</span> : null}
									</td>
								</tr>
							))}
							<tr key="sum" class="s4vp-total">
								<td>{t.split.sum}</td>
								<td>{''}</td>
								{hasPreview ? <td class="s4vp-r s4vp-nw">{money(previewSum)}</td> : null}
								<td class={diff === 0 ? 's4vp-r s4vp-nw' : 's4vp-r s4vp-nw s4vp-out-diff'}>{saved === 0 ? '0' : money(saved)}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
		);
	};

	// ------------------------------------------------------------------ bước 4 - 6: gửi duyệt, duyệt, vào bảng lương
	const fact = (label, value, strong) => (
		<div class="s4vp-line" style={strong ? {fontWeight: '700'} : {}}>
			<span class="s4vp-muted">{label}</span>
			<span class="s4vp-out-val">{value}</span>
		</div>
	);
	const summary = (r) => (
		<div class="s4vp-out-info">
			{fact(t.detail.total, r.total ? money(r.total) : '0', true)}
			{r.type === 'T' ? fact(t.detail.split, r.splitTotal ? money(r.splitTotal) : '0') : null}
			{r.type === 'T' && r.splitTotal && r.splitTotal !== r.total ? fact(t.detail.diff, <span class="s4vp-out-diff">{money(Math.abs(r.splitTotal - r.total))}</span>) : null}
			{fact(t.detail.peopleCount, t.people(r.people || 0))}
			{r.type === 'T' ? fact(t.detail.method, t.method[r.splitMethod] || r.splitMethod || '') : null}
			{r.description ? fact(t.detail.description, r.description) : null}
		</div>
	);
	const doAction = (r, op, confirmText, doneText) => app.confirm(confirmText, () => act({action: 'outputAction', id: r.id, op}, doneText, () => setTab('')));
	const blockers = (r) => {
		const d = draftOf(r);
		const out = [];
		if (d.linesDirty || d.membersDirty || d.amountsDirty) out.push(t.submit.blockUnsaved);
		if (!(r.total > 0)) out.push(t.submit.blockNoLines);
		if (r.type === 'T' && !list(r.members).length) out.push(t.submit.blockNoMembers);
		if (r.type === 'T' && list(r.members).length && r.total > 0) {
			if (r.hasManual && r.splitTotal !== r.total) out.push(t.submit.blockSplit);
			else if (!r.hasManual && r.splitError) out.push(t.split.cannot(serverText(r.splitError.en, r.splitError.vi)));
		}
		if (!r.period) out.push(t.submit.blockNoPeriod);
		else if (r.periodStatus === 'C') out.push(t.submit.blockClosed);
		else if (r.periodAtt === 'L') out.push(t.submit.blockLocked);
		return out;
	};
	const submitStep = (r) => {
		if (r.status !== 'H') return <div class="s4vp-out-body"><div class="s4vp-out-okay" role="note">{t.submit.sent}</div>{summary(r)}</div>;
		const blocks = blockers(r);
		const reason = !canWrite ? t.readOnly : blocks[0] || '';
		return (
			<div class="s4vp-out-body">
				<div class="s4vp-out-acts">
					<Button label={t.submit.run} kind="primary" disabled={!!reason || !!app.busy} title={reason} onClick={() => doAction(r, 'submit', t.submit.confirm(r.name, money(r.total), r.people || 0), t.submit.done(r.name))} />
				</div>
				{blocks.map((b, i) => <div key={`b${i}`} class="s4vp-out-warn" role="note">{b}</div>)}
				{blocks.length ? null : <span class="s4vp-small">{r.type === 'T' && !r.hasManual ? `${t.submit.intro} ${t.submit.autoSplit}` : t.submit.intro}</span>}
				{summary(r)}
			</div>
		);
	};
	const approveStep = (r) => {
		if (r.status === 'H') return <div class="s4vp-out-body"><span class="s4vp-small">{t.approve.notSent}</span>{summary(r)}</div>;
		if (r.status !== 'P') return <div class="s4vp-out-body"><div class="s4vp-out-okay" role="note">{t.approve.approvedBy(r.approvedBy || '', fmtDate(r.approvedDate))}</div>{summary(r)}</div>;
		const reason = canWrite ? '' : t.readOnly;
		return (
			<div class="s4vp-out-body">
				<div class="s4vp-out-acts">
					<Button label={t.approve.run} kind="primary" disabled={!!reason || !!app.busy} title={reason} onClick={() => doAction(r, 'approve', t.approve.confirm(r.name, money(r.total), r.people || 0), t.approve.done(r.name))} />
					<Button label={t.approve.reject} disabled={!!reason || !!app.busy} title={reason} onClick={() => doAction(r, 'hold', t.approve.confirmReject(r.name), t.approve.rejected(r.name))} />
				</div>
				<span class="s4vp-small">{t.approve.waiting}</span>
				{summary(r)}
			</div>
		);
	};
	const payrollStep = (r) => {
		if (r.status === 'C') {
			return (
				<div class="s4vp-out-body">
					<div class="s4vp-out-acts">
						{r.batch ? <Button label={t.payroll.open(r.batchName || r.batch)} kind="primary" onClick={() => app.go('payrollRun', {id: r.batch})} /> : null}
					</div>
					<div class="s4vp-out-okay" role="note">{t.payroll.included(r.batchName || r.batch || '')}</div>
					{summary(r)}
				</div>
			);
		}
		if (r.status !== 'A') return <div class="s4vp-out-body"><span class="s4vp-small">{t.payroll.notYet}</span>{summary(r)}</div>;
		// Bảng lương đang mở của đúng kỳ của phiếu (chưa ghi sổ, chưa hủy): mở thẳng để tính lương
		const open = list(view.batches).find((b) => r.period && String(b.period) === String(r.period) && b.status !== 'R' && b.status !== 'V');
		const reason = canWrite ? '' : t.readOnly;
		return (
			<div class="s4vp-out-body">
				<div class="s4vp-out-acts">
					{open ? <Button label={t.payroll.open(open.name || open.id)} kind="primary" onClick={() => app.go('payrollRun', {id: open.id})} /> : <Button label={t.payroll.goList} kind="primary" onClick={() => app.go('payrollList')} />}
					<Button label={t.payroll.hold} disabled={!!reason || !!app.busy} title={reason} onClick={() => doAction(r, 'hold', t.payroll.confirmHold(r.name), t.payroll.held(r.name))} />
				</div>
				<div class="s4vp-out-okay" role="note">{t.approve.approvedBy(r.approvedBy || '', fmtDate(r.approvedDate))}</div>
				<span class="s4vp-small">{t.payroll.waiting(r.periodName || '')}</span>
				{summary(r)}
			</div>
		);
	};

	// ------------------------------------------------------------------ khung chi tiết
	const noProfileNames = (r) => (r.type === 'T' ? list(r.members) : list(r.lines)).filter((x) => x.noProfile).map(who).filter((x, i, a) => a.indexOf(x) === i).join(', ');
	const issueText = (r, code) => {
		if (code === 'PERIOD_POSTED') return t.issue.PERIOD_POSTED((r.postedBatch && r.postedBatch.name) || '');
		if (code === 'SPLIT_MISMATCH') return t.issue.SPLIT_MISMATCH(money(r.splitTotal), money(r.total));
		if (code === 'NO_PROFILE') return t.issue.NO_PROFILE(noProfileNames(r));
		return t.issue[code] || code;
	};
	const issueStep = (r, code) => {
		if (code === 'NO_LINES' || code === 'RATE_MISSING') return 'lines';
		if (code === 'NO_MEMBERS') return 'members';
		if (code === 'NO_PROFILE') return r.type === 'T' ? 'members' : 'lines';
		if (code === 'NOT_SPLIT' || code === 'SPLIT_MISMATCH') return 'split';
		return '';
	};
	const detailPanel = (r) => {
		const keys = STEPS[r.type] || STEPS.I;
		const cur = stepOf(r);
		const shown = keys.indexOf(tab) >= 0 ? tab : cur;
		const curIdx = keys.indexOf(cur);
		const editable = r.status === 'H' && canWrite;
		const sub = [t.status[r.status] || r.status, fmtDate(r.date), t.kind[r.kind] || r.kind, r.teamName, r.rateTableName, r.projectName, r.periodName ? t.detail.periodOf(r.periodName) : t.detail.noPeriod].filter(Boolean).join(' · ');
		const actions = [];
		if (editable) actions.push(<Button small={true} label={t.detail.edit} disabled={!!app.busy} onClick={() => openForm(r)} />);
		actions.push(<Button small={true} kind="ghost" label={t.detail.openRecord} onClick={() => openRecord(RECORD_TYPE, r.id)} />);
		let body;
		if (shown === 'lines') body = linesStep(r, editable);
		else if (shown === 'members') body = membersStep(r, editable);
		else if (shown === 'split') body = splitStep(r, editable);
		else if (shown === 'submit') body = submitStep(r);
		else if (shown === 'approve') body = approveStep(r);
		else body = payrollStep(r);
		const locked = !editable && (shown === 'lines' || shown === 'members' || shown === 'split');
		return (
			<SidePanel title={r.name || String(r.id)} sub={sub} onClose={() => pickEntry('')} actions={actions}>
				<div class="s4vp-out-steps" role="group" aria-label={t.steps.label}>
					{keys.map((k, i) => {
						const state = r.status === 'C' || i < curIdx ? 'done' : i === curIdx ? 'cur' : 'todo';
						return (
							<button key={k} type="button" class={`s4vp-out-step s4vp-out-step-${state}${k === shown ? ' s4vp-out-step-on' : ''}`} aria-pressed={k === shown ? 'true' : 'false'} onClick={() => pickTab(k)}>
								<span class="s4vp-out-step-n">{String(i + 1)}</span>
								<span>{t.steps[k]}</span>
							</button>
						);
					})}
				</div>
				{list(r.issues).length ? (
					<div class="s4vp-out-issues">
						{list(r.issues).map((code) => {
							const step = issueStep(r, code);
							const canFix = step ? step !== shown : editable;
							return (
								<div key={code} class="s4vp-out-issue" role="note">
									<span>{issueText(r, code)}</span>
									{canFix ? <Button small={true} label={t.issue.fix} onClick={() => (step ? pickTab(step) : openForm(r))} /> : null}
								</div>
							);
						})}
					</div>
				) : null}
				{locked ? <span class="s4vp-small">{canWrite ? t.detail.lockedNote : t.readOnly}</span> : null}
				{body}
			</SidePanel>
		);
	};

	// ------------------------------------------------------------------ hộp thoại tạo / sửa phiếu
	const putForm = (patch) => {
		formRef.current = Object.assign({}, formRef.current, patch);
		setForm(formRef.current);
	};
	const openForm = (r) => {
		ensureLookups().then((lk) => {
			if (!lk || !alive.current) return;
			const inPeriod = period && periods.find((p) => String(p.id) === String(period) && p.start <= localToday() && p.end >= localToday());
			formRef.current = r
				? {id: r.id, name: r.name, kind: r.kind, date: r.date || '', rateTable: String(r.rateTable || ''), team: String(r.team || ''), method: r.splitMethod || 'F', period: String(r.period || ''), project: String(r.project || ''), description: r.description || '', errors: {}, was: {date: r.date || '', rateTable: String(r.rateTable || ''), project: String(r.project || '')}}
				: {id: '', name: '', kind: 'T', date: localToday(), rateTable: '', team: '', method: 'F', period: inPeriod ? String(period) : '', project: '', description: '', errors: {}, was: null};
			setForm(formRef.current);
		});
	};
	const submitForm = () => {
		const f = formRef.current;
		const errors = {};
		if (!validIso(f.date)) errors.date = t.form.errDate;
		if (!f.rateTable) errors.rateTable = t.form.errTable;
		if (f.kind === 'T' && !f.team) errors.team = t.form.errTeam;
		if (Object.keys(errors).length) {
			putForm({errors});
			return;
		}
		const team = f.kind === 'T' ? f.team : null;
		const values = {doc_date: f.date, type: f.kind === 'T' ? 'T' : 'I', rate_table: f.rateTable, team, split_method: f.kind === 'T' ? f.method || 'F' : null, period: f.period || null, project: f.project || null, description: String(f.description || '').trim()};
		const body = {action: 'saveOutput', values};
		if (f.id) {
			values.id = f.id;
			// Đổi ngày, bảng đơn giá hoặc dự án: gửi lại dòng với đơn giá trống để máy chủ định giá lại theo bảng
			const row = all.find((x) => String(x.id) === String(f.id));
			const changed = f.was && (f.was.date !== f.date || f.was.rateTable !== f.rateTable || f.was.project !== f.project);
			if (row && changed && list(row.lines).length) body.lines = row.lines.map((l) => ({employee: l.employee || null, item: l.item, description: l.description, uom: l.uom, qty: l.qty, rate: ''}));
		} else values.subsidiary = subsidiary;
		app.run(t.working, send(body)).then((res) => {
			if (!res || !alive.current) return;
			setForm(null);
			const id = String(res.id || f.id || '');
			load().then((fresh) => {
				if (!alive.current) return;
				const row = fresh ? list(fresh.rows).find((x) => String(x.id) === id) : null;
				setFilter('');
				pickEntry(id, '');
				// Phiếu mới thuộc kỳ khác kỳ đang lọc: chuyển sang xem mọi kỳ để thấy phiếu
				if (!row && period) setPeriod('');
				const warnings = list(res.warnings).map((w) => serverText(w.message, w.messageVi)).filter(Boolean);
				if (warnings.length) app.notify(warnings.join(' '), 'warn');
				else app.notify(f.id ? t.form.saved(f.name) : t.form.created(row ? row.name : ''), 'ok');
			});
		});
	};
	const formDialog = () => {
		const f = form;
		const lk = lookups || {};
		const isNew = !f.id;
		const tables = list(lk.rateTables).filter((x) => (f.kind === 'S' ? x.type === 'S' : x.type !== 'S'));
		const tableOptions = tables.map((x) => ({value: x.id, label: [x.code, x.description].filter(Boolean).join(' - ')}));
		const teamOptions = list(lk.teams).map((x) => ({value: x.id, label: [x.code, x.description].filter(Boolean).join(' - ')}));
		const projectOptions = list(lk.projects).map((x) => ({value: x.id, label: x.name}));
		if (f.project && !projectOptions.some((o) => o.value === f.project)) projectOptions.push({value: f.project, label: f.project});
		const periodOptions = periods.filter((p) => p.status !== 'C' || String(p.id) === f.period).map((p) => ({value: String(p.id), label: `${p.code} (${fmtDate(p.start)} - ${fmtDate(p.end)})`}));
		const err = (k) => (f.errors && f.errors[k] ? <span class="s4vp-out-err">{f.errors[k]}</span> : null);
		const pickKind = (k) => {
			const keep = list(lk.rateTables).some((x) => x.id === f.rateTable && (k === 'S' ? x.type === 'S' : x.type !== 'S'));
			putForm({kind: k || 'T', rateTable: keep ? f.rateTable : '', team: k === 'T' ? f.team : ''});
		};
		const pickTeam = (id) => {
			const team = list(lk.teams).find((x) => x.id === id);
			putForm(team && isNew ? {team: id, method: team.splitMethod || 'F', project: team.project && projectOptions.some((o) => o.value === String(team.project)) ? String(team.project) : f.project} : {team: id});
		};
		const changed = f.was && (f.was.date !== f.date || f.was.rateTable !== f.rateTable || f.was.project !== f.project);
		return (
			<Dialog
				title={isNew ? t.form.titleNew : t.form.titleEdit(f.name)}
				width={760}
				onClose={() => setForm(null)}
				actions={[<Button label={t.form.cancel} onClick={() => setForm(null)} />, <Button label={isNew ? t.form.create : t.form.save} kind="primary" disabled={!!app.busy} onClick={submitForm} />]}
			>
				<div class="s4vp-form">
					<Field label={t.form.kind}>
						<Select value={f.kind} onInput={pickKind} options={KINDS.map((k) => ({value: k, label: t.kind[k]}))} disabled={!isNew} />
					</Field>
					<Field label={t.form.date} hint={err('date')} required={true}>
						<DateInput value={f.date} onInput={(v) => putForm({date: v})} />
					</Field>
					<Field label={t.form.table} required={true} hint={err('rateTable') || (tables.length ? null : t.form.noTables)}>
						<AutoSelect value={f.rateTable} onInput={(v) => putForm({rateTable: v})} options={tableOptions} placeholder={t.form.tablePick} />
					</Field>
					{f.kind === 'T' ? (
						<Field label={t.form.team} hint={err('team')} required={true}>
							<AutoSelect value={f.team} onInput={pickTeam} options={teamOptions} placeholder={t.form.teamPick} />
						</Field>
					) : null}
					{f.kind === 'T' ? (
						<Field label={t.form.method}>
							<Select value={f.method} onInput={(v) => putForm({method: v || 'F'})} options={METHODS.map((k) => ({value: k, label: t.method[k]}))} />
						</Field>
					) : null}
					<Field label={t.form.period} hint={t.form.periodHint}>
						<AutoSelect value={f.period} onInput={(v) => putForm({period: v})} options={periodOptions} placeholder={t.form.periodAuto} />
					</Field>
					<Field label={t.form.project} hint={lk.projectsMore ? t.form.projectMore : t.form.projectHint}>
						<AutoSelect value={f.project} onInput={(v) => putForm({project: v})} options={projectOptions} placeholder={t.form.projectNone} />
					</Field>
					<Field label={t.form.description}>
						<TextInput value={f.description} onInput={(v) => putForm({description: v})} />
					</Field>
				</div>
				{changed ? <div class="s4vp-out-warn" role="note">{t.form.repriced}</div> : null}
				<span class="s4vp-small">{t.form.moreOnRecord}</span>
			</Dialog>
		);
	};

	// ------------------------------------------------------------------ bảng phiếu
	const issueCode = filter.indexOf('i:') === 0 ? filter.slice(2) : '';
	const rows = all
		.filter((r) => (!filter ? true : filter === 'todo' ? list(r.issues).length > 0 : issueCode ? list(r.issues).indexOf(issueCode) >= 0 : r.status === filter))
		// Chữ hiển thị (trạng thái, loại, ngày dd/mm/yyyy, việc cần xử lý) đưa vào dòng để ô tìm khớp được
		.map((r) => Object.assign({}, r, {
			statusText: t.status[r.status] || r.status || '',
			kindText: t.kind[r.kind] || r.kind || '',
			dateText: fmtDate(r.date),
			splitText: r.type === 'T' ? (r.splitTotal ? money(r.splitTotal) : '-') : t.people(r.people || 0),
			issueText: list(r.issues).map((c) => t.todo[c] || c).join(', '),
			lines: null,
			members: null,
		}));
	const shownCurrent = current ? rows.find((r) => String(r.id) === String(current.id)) || null : null;
	const total = rows.length > 1 ? {name: t.total(rows.length), total: rows.reduce((s, r) => s + (Number(r.total) || 0), 0), splitText: money(rows.reduce((s, r) => s + (r.type === 'T' ? Number(r.splitTotal) || 0 : 0), 0))} : null;
	const wide = !current;
	const columns = [
		{key: 'name', label: t.cols.number, nowrap: true, render: (r) => <span class="s4vp-link">{r.name || r.id}</span>},
		{key: 'date', label: t.cols.date, type: 'date', nowrap: true},
		{key: 'kindText', label: t.cols.kind, nowrap: true},
		{key: 'teamName', label: t.cols.team, render: (r) => <span class="s4vp-out-clip" title={[r.teamName, r.teamDescription].filter(Boolean).join(' - ')}>{r.teamName || ''}</span>},
		wide ? {key: 'projectName', label: t.cols.project, render: (r) => <span class="s4vp-out-clip" title={r.projectName || ''}>{r.projectName || ''}</span>} : null,
		wide ? {key: 'rateTableName', label: t.cols.table, render: (r) => <span class="s4vp-out-clip" title={[r.rateTableName, r.rateTableDescription].filter(Boolean).join(' - ')}>{r.rateTableName || ''}</span>} : null,
		{key: 'total', label: t.cols.total, type: 'money', nowrap: true},
		{key: 'splitText', label: t.cols.split, align: 'right', nowrap: true, render: (r) => <span class={r.type === 'T' && r.total > 0 && r.splitTotal !== r.total ? 's4vp-out-diff' : 's4vp-out-plain'}>{r.splitText}</span>},
		{key: 'status', label: t.cols.status, nowrap: true, render: (r) => (
			<span class="s4vp-out-status">
				<Badge text={r.statusText} tone={TONE[r.status] || 'muted'} />
				{r.issueText ? <span class="s4vp-out-flag" title={r.issueText}>{'!'}</span> : null}
			</span>
		)},
		wide ? {key: 'batchName', label: t.cols.batch, nowrap: true, noRowClick: true, render: (r) => (r.batch ? <Button kind="link" label={r.batchName || String(r.batch)} onClick={() => app.go('payrollRun', {id: r.batch})} /> : '')} : null,
	];
	const chipItems = [{value: '', label: t.chips.all, count: counts.all || 0}]
		.concat(counts.attention ? [{value: 'todo', label: t.chips.todo, count: counts.attention, tone: 'warn'}] : [])
		.concat(STATUSES.map((s) => ({value: s, label: t.status[s], count: counts[s] || 0, tone: s === 'P' && counts.P ? 'warn' : ''})));

	const pending = cards.pending || {};
	const approved = cards.approved || {};
	const sumCard = cards.total || {};
	const included = cards.included || {};
	const zero = (v) => (v ? money(v) : '0');
	const statCards = [
		{key: 'pending', label: t.cards.pending, value: zero(pending.amount), note: t.cards.pendingNote(pending.count || 0), tone: pending.count ? 'warn' : ''},
		{key: 'approved', label: t.cards.approved, value: zero(approved.amount), note: t.cards.approvedNote(approved.count || 0), tone: approved.count ? 'info' : ''},
		{key: 'total', label: t.cards.total, value: zero(sumCard.amount), note: t.cards.totalNote(sumCard.count || 0, sumCard.holdCount || 0)},
		{key: 'included', label: t.cards.included, value: zero(included.amount), note: t.cards.includedNote(included.count || 0, list(included.batches).map((b) => b.name).filter(Boolean).slice(0, 3).join(', ')), tone: included.count ? 'ok' : ''},
	];
	const todo = list(view.issues);
	const periodOptions = periods.map((p) => ({value: String(p.id), label: `${p.code} (${fmtDate(p.start)} - ${fmtDate(p.end)})`}));

	return (
		<Page>
			<PageHeader
				title={t.title}
				sub={!subsidiary ? t.noSubsidiary : canWrite ? t.sub : t.readOnly}
				actions={[
					<span class="s4vp-out-period">
						<AutoSelect value={period} onInput={(v) => (setPeriod(v || ''), pickEntry(''))} options={periodOptions} placeholder={t.allPeriods} ariaLabel={t.period} width={250} />
					</span>,
					<Button label={t.legacy} kind="ghost" onClick={() => app.go('outputs')} />,
					<Button label={t.refresh} onClick={() => load()} />,
					<Button label={t.newEntry} kind="primary" disabled={!subsidiary || !canWrite || !!app.busy} title={canWrite ? '' : t.readOnly} onClick={() => openForm(null)} />,
				]}
			/>
			<StatCards cards={statCards} />
			{todo.length ? (
				<div class="s4vp-out-todo" role="group" aria-label={t.todo.label}>
					<span class="s4vp-out-todo-l">{t.todo.label}</span>
					{todo.map((g) => {
						const on = filter === `i:${g.code}`;
						return (
							<button key={g.code} type="button" class={on ? 's4vp-out-todo-btn s4vp-on' : 's4vp-out-todo-btn'} aria-pressed={on ? 'true' : 'false'} onClick={() => setFilter(on ? '' : `i:${g.code}`)}>
								{`${t.todo[g.code] || g.code} ${g.count}`}
							</button>
						);
					})}
					{issueCode ? <Button small={true} kind="ghost" label={t.todo.clear} onClick={() => setFilter('')} /> : null}
				</div>
			) : null}
			<div class="s4vp-cols">
				<div class="s4vp-col-main">
					<Card flush={true} label={t.title}>
						<Table
							label={t.title}
							columns={columns}
							rows={rows}
							keyOf={(r) => r.id}
							onRowClick={(r) => pickEntry(String(r.id) === String(selected) ? '' : r.id)}
							selectedKey={shownCurrent ? shownCurrent.id : ''}
							total={total}
							empty={filter ? t.emptyFilter : t.empty}
							search={true}
							searchPlaceholder={t.search}
							maxHeight={todo.length ? 'max(240px, calc(100vh - 432px))' : 'max(260px, calc(100vh - 384px))'}
							toolbar={<Chips items={chipItems} value={issueCode ? 'todo' : filter} onPick={setFilter} label={t.chips.label} />}
						/>
					</Card>
				</div>
				{current ? <div class={todo.length ? 's4vp-col-side s4vp-out-side s4vp-out-side-low' : 's4vp-col-side s4vp-out-side'}>{detailPanel(current)}</div> : null}
			</div>
			{form ? formDialog() : null}
		</Page>
	);
}
