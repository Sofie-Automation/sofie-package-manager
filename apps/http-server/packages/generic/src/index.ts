import { PackageProxyServer } from './server'
import {
	getHTTPServerConfig,
	ProcessHandler,
	setupLogger,
	initializeLogger,
	stringifyError,
	HealthEndpoints,
	StatusCode,
} from '@sofie-package-manager/api'

export { PackageProxyServer }
export async function startProcess(): Promise<void> {
	const config = await getHTTPServerConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	logger.info('------------------------------------------------------------------')
	logger.info('Starting HTTP Server')

	const process = new ProcessHandler(logger)
	process.init(config.process)

	let initialized = false

	new HealthEndpoints(
		{ port: config.health.port },
		{
			getStatus: () => {
				if (!initialized) return { statusCode: StatusCode.BAD, messages: ['HTTP server not yet initialized'] }
				return { statusCode: StatusCode.GOOD, messages: [] }
			},
			isReady: () => initialized,
		}
	)

	const app = new PackageProxyServer(logger, config)
	app.init()
		.then(() => {
			initialized = true
		})
		.catch((e) => {
			logger.error(`Error in PackageProxyServer.init: ${stringifyError(e)}`)
		})
}
