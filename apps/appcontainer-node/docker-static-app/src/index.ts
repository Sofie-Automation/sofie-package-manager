import {
	getAppContainerConfig,
	ProcessHandler,
	setupLogger,
	stringifyError,
	initializeLogger,
} from '@sofie-package-manager/api'
import { AppContainer } from '@appcontainer-node/generic'
/* eslint-disable no-console */

async function startProcess(): Promise<void> {
	const config = await getAppContainerConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	try {
		logger.info('------------------------------------------------------------------')
		logger.info('Starting AppContainer')
		logger.info('------------------------------------------------------------------')

		const process = new ProcessHandler(logger)
		process.init(config.process)

		const appContainer = new AppContainer(logger, config)

		await appContainer.init()

		logger.info('------------------------------------------------------------------')
		logger.info('Initialized!')
		logger.info('------------------------------------------------------------------')
	} catch (error) {
		logger.error(`Error in startProcess: ${stringifyError(error)}`)
	}
}

console.log('process started') // This is a message all Sofie processes log upon startup
startProcess().catch(console.error)
