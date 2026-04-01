import { QuantelHTTPTransformerProxy } from './server'
import {
	getQuantelHTTPTransformerProxyConfig,
	ProcessHandler,
	initializeLogger,
	stringifyError,
	setupLogger,
	HealthEndpoints,
	StatusCode,
} from '@sofie-package-manager/api'

export { QuantelHTTPTransformerProxy }
export async function startProcess(): Promise<void> {
	const config = await getQuantelHTTPTransformerProxyConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Quantel HTTP Transformer Proxy Server')

	const process = new ProcessHandler(logger)
	process.init(config.process)

	let initialized = false

	new HealthEndpoints(
		{ port: config.health.port },
		{
			getStatus: () => {
				if (!initialized) return { statusCode: StatusCode.BAD, messages: ['Quantel proxy not yet initialized'] }
				return { statusCode: StatusCode.GOOD, messages: [] }
			},
			isReady: () => initialized,
		}
	)

	const app = new QuantelHTTPTransformerProxy(logger, config)
	app.init()
		.then(() => {
			initialized = true
		})
		.catch((e) => {
			logger.error(`Error in QuantelHTTPTransformerProxy.init: ${stringifyError(e)}`)
		})
}
