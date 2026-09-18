import {
	getWorkforceConfig,
	HealthEndpoints,
	initializeLogger,
	setupLogger,
	stringifyError,
} from '@sofie-package-manager/api'
import { Workforce } from '@sofie-package-manager/workforce'

export async function startProcess(): Promise<void> {
	const config = await getWorkforceConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Workforce')
	logger.info('Port: ' + config.workforce.port)
	logger.info('------------------------------------------------------------------')

	const workforce = new Workforce(logger, config)

	new HealthEndpoints(
		{ port: config.health.port },
		{
			getStatus: () => workforce.getStatus(),
			isReady: () => true,
		}
	)

	workforce.init().catch((e) => logger.error(stringifyError(e)))
}
