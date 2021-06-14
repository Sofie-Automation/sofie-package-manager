import Winston from 'winston'
import { ProcessConfig } from './config'

export interface LoggerInstance extends Winston.LoggerInstance {
	warning: never // logger.warning is not a function
}

/** Sets up logging for a process. Intended to be run when a new process is started. */
export function setupLogging(config: { process: ProcessConfig }): LoggerInstance {
	// Setup logging --------------------------------------
	const logPath = config.process.logPath

	const logger = new Winston.Logger({}) as LoggerInstance
	if (logPath) {
		// Log json to file, human-readable to console
		logger.add(Winston.transports.Console, {
			level: 'verbose',
			handleExceptions: true,
			json: false,
		})
		logger.add(Winston.transports.File, {
			level: 'debug',
			handleExceptions: true,
			json: true,
			filename: logPath,
		})
		logger.info('Logging to', logPath)
		// Hijack console.log:
		// const orgConsoleLog = console.log
		// console.log = function (...args: any[]) {
		// 	// orgConsoleLog('a')
		// 	if (args.length >= 1) {
		// 		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// 		// @ts-ignore one or more arguments
		// 		logger.debug(...args)
		// 		orgConsoleLog(...args)
		// 	}
		// }
	} else {
		// Log json to console
		logger.add(Winston.transports.Console, {
			handleExceptions: true,
			json: true,
			stringify: (obj) => {
				obj.localTimestamp = getCurrentTime()
				obj.randomId = Math.round(Math.random() * 10000)
				return JSON.stringify(obj) // make single line
			},
		})
		logger.info('Logging to Console')
		// Hijack console.log:
		// eslint-disable-next-line no-console
		// console.log = function (...args: any[]) {
		// 	// orgConsoleLog('a')
		// 	if (args.length >= 1) {
		// 		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// 		// @ts-ignore one or more arguments
		// 		logger.debug(...args)
		// 	}
		// }
	}
	function getCurrentTime() {
		const v = Date.now()
		return new Date(v).toISOString()
	}

	// Because the default NodeJS-handler sucks and wont display error properly
	process.on('unhandledRejection', (reason: any, p: any) => {
		logger.error('Unhandled Promise rejection, see below')
		logger.error('reason:', reason)
		logger.error('promise:', p)
		// logger.error('c:', c)
	})
	process.on('warning', (e: any) => {
		logger.warn('Unhandled warning, see below')
		logger.error('error', e)
		logger.error('error.reason', e.reason || e.message)
		logger.error('error.stack', e.stack)
	})
	return logger
}
