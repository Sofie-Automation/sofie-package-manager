import {
	getWorkerConfig,
	ProcessHandler,
	setupLogger,
	initializeLogger,
	stringifyError,
	HealthEndpoints,
	StatusCode,
} from '@sofie-package-manager/api'
import { WorkerAgent } from '@sofie-package-manager/worker'

export async function startProcess(): Promise<void> {
	const config = await getWorkerConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	logger.info('------------------------------------------------------------------')
	logger.info(`Starting Worker: PID=${process.pid}`)
	logger.info('------------------------------------------------------------------')

	const processHandler = new ProcessHandler(logger)
	processHandler.init(config.process)

	const workerAgent = new WorkerAgent(logger, config)
	let initialized = false

	new HealthEndpoints(
		{ port: config.health.port },
		{
			getStatus: () => {
				if (!initialized) return { statusCode: StatusCode.BAD, messages: ['Worker not yet initialized'] }
				return { statusCode: StatusCode.GOOD, messages: [] }
			},
			isReady: () => initialized,
		}
	)

	process.on('exit', (code) => {
		logger.info(`Worker: Closing with exitCode: ${code}`)
		workerAgent.terminate()
	})

	workerAgent
		.init()
		.then(() => {
			initialized = true
		})
		.catch((e) => {
			logger.error(`Worker: Error in init: ${stringifyError(e)}`)
		})
}
