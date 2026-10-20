import PayrollApp from './PayrollApp.js';

export const run = (context) => {
	context.setLayout('application');
	context.setContent(<PayrollApp />);
};
