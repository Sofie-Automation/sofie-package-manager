import {
	getAppContainerConfig,
	ProcessHandler,
	setupLogger,
	stringifyError,
	initializeLogger,
	HealthEndpoints,
	StatusCode,
} from '@sofie-package-manager/api'
import { AppContainer } from './appContainer'

export { AppContainer } from './appContainer'

export async function startProcess(): Promise<void> {
	const config = await getAppContainerConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	try {
		logger.info('------------------------------------------------------------------')
		logger.info('Starting AppContainer')
		logger.info('------------------------------------------------------------------')

		const process = new ProcessHandler(logger)
		process.init(config.process)

		let initialized = false

		const appContainer = new AppContainer(logger, config)

		new HealthEndpoints(
			{ port: config.health.port },
			{
				getStatus: () => {
					if (!initialized)
						return { statusCode: StatusCode.BAD, messages: ['AppContainer not yet initialized'] }
					return { statusCode: StatusCode.GOOD, messages: [] }
				},
				isReady: () => initialized,
			}
		)

		await appContainer.init()
		initialized = true

		logger.info('------------------------------------------------------------------')
		logger.info('Initialized!')
		logger.info('------------------------------------------------------------------')
	} catch (error) {
		logger.error(`Error in startProcess: ${stringifyError(error)}`)
	}
}
