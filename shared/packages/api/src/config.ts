import { Options } from 'yargs'
import yargs = require('yargs/yargs')
import _ from 'underscore'
import { WorkerAgentConfig } from './worker'
import { AppContainerConfig } from './appContainer'
import { protectString } from './ProtectedString'
import { AppContainerId, WorkerAgentId } from './ids'
import { countOccurrences } from './lib'
import { URLMap } from './methods'
import { Expectation } from './expectationApi'

/*
 * This file contains various CLI argument definitions, used by the various processes that together constitutes the Package Manager
 */

/** Generic CLI-argument-definitions for any process */
export const processOptions = defineArguments({
	logPath: { type: 'string', describe: 'Set to write logs to this file' },
	logLevel: { type: 'string', describe: 'Set default log level. (Might be overwritten by Sofie Core)' },

	unsafeSSL: {
		type: 'boolean',
		default: process.env.UNSAFE_SSL === '1',
		describe: 'Set to true to allow all SSL certificates (only use this in a safe, local environment)',
	},
	certificates: { type: 'string', describe: 'SSL Certificates' },
})
/** CLI-argument-definitions for the Workforce process */
const workforceArguments = defineArguments({
	port: {
		type: 'number',
		default: parseInt(process.env.WORKFORCE_PORT || '', 10) || 8070,
		describe: 'The port number to start the Workforce websocket server on',
	},
	allowNoAppContainers: {
		type: 'boolean',
		default: process.env.WORKFORCE_ALLOW_NO_APP_CONTAINERS === '1' || false,
		describe: 'If true, the workforce will not check if it has no appContainers connected',
	},
})
/** CLI-argument-definitions for the HTTP-Server process */
const httpServerArguments = defineArguments({
	httpServerPort: {
		type: 'number',
		default: parseInt(process.env.HTTP_SERVER_PORT || '', 10) || 8080,
		describe: 'The port number to use for the HTTP server',
	},
	apiKeyRead: {
		type: 'string',
		default: process.env.HTTP_SERVER_API_KEY_READ || undefined,
		describe: 'Set this to limit read-access',
	},
	apiKeyWrite: {
		type: 'string',
		default: process.env.HTTP_SERVER_API_KEY_WRITE || undefined,
		describe: 'Set this to limit write-access',
	},
	cleanFileAge: {
		type: 'number',
		default: parseInt(process.env.HTTP_SERVER_CLEAN_FILE_AGE || '0', 10) || 3600 * 24 * 30, // default: 30 days
		describe:
			'Automatically remove files older than this age, in seconds (defaults to 30 days). Set to -1 to disable.',
	},
	basePath: {
		type: 'string',
		default: process.env.HTTP_SERVER_BASE_PATH || './fileStorage',
		describe: 'The internal path to use for file storage',
	},
})
/** CLI-argument-definitions for the Package Manager process */
const packageManagerArguments = defineArguments({
	coreHost: {
		type: 'string',
		default: process.env.CORE_HOST || '127.0.0.1',
		describe: 'The IP-address/hostName to Sofie Core',
	},
	corePort: {
		type: 'number',
		default: parseInt(process.env.CORE_PORT || '', 10) || 3000,
		describe: 'The port number of Sofie core (usually 80, 443 or 3000)',
	},

	deviceId: {
		type: 'string',
		default: process.env.DEVICE_ID || '',
		describe: '(Optional) Unique devide id of this device',
	},
	deviceToken: {
		type: 'string',
		default: process.env.DEVICE_TOKEN || '',
		describe: '(Optional) access token of this device.',
	},

	disableWatchdog: {
		type: 'boolean',
		default: process.env.DISABLE_WATCHDOG === '1',
		describe: 'Set to true to disable the Watchdog (it kills the process if connection to Core is lost)',
	},

	port: {
		type: 'number',
		default: parseInt(process.env.PACKAGE_MANAGER_PORT || '', 10) || 8060,
		describe: 'The port number to start the Package Manager websocket server on',
	},
	accessURL: {
		type: 'string',
		default: process.env.PACKAGE_MANAGER_URL || 'ws://localhost:8060',
		describe:
			'A list of URLs where Package Manager websocket server can be accessed and the respective networkIds where they should be used. No networkId or a `*` means a catch-all public URL. ("networkA@ws://10.0.0.1;networkB@ws://192.168.0.1;ws://public.com")',
	},
	workforceURL: {
		type: 'string',
		default: process.env.WORKFORCE_URL || 'ws://localhost:8070',
		describe: 'The URL to the Workforce',
	},
	watchFiles: {
		type: 'boolean',
		default: process.env.WATCH_FILES === '1',
		describe: 'If true, will watch the file "expectedPackages.json" as an additional source of expected packages.',
	},
	noCore: {
		type: 'boolean',
		default: process.env.NO_CORE === '1',
		describe: 'If true, Package Manager wont try to connect to Sofie Core',
	},
	chaosMonkey: {
		type: 'boolean',
		default: process.env.CHAOS_MONKEY === '1',
		describe: 'If true, enables the "chaos monkey"-feature, which will randomly kill processes every few seconds',
	},
	concurrency: {
		type: 'number',
		default: parseInt(process.env.CONCURRENCY || '', 10) || undefined,
		describe: 'How many expectation states can be evaluated at the same time',
	},
})

/** CLI Arguments that can be passed through via an AppContainer */
const workerArgumentsGeneric = defineArguments({
	sourcePackageStabilityThreshold: {
		type: 'number',
		default: process.env.WORKER_SOURCE_PACKAGE_STABILITY_THRESHOLD || '',
		describe:
			'The time to wait when determining if the source package is stable or not (this is used to wait for growing files). Set to 0 to disable the stability check. Defaults to 4000 ms',
	},
	windowsDriveLetters: {
		type: 'string',
		default: process.env.WORKER_WINDOWS_DRIVE_LETTERS || 'X;Y;Z',
		describe: 'Which Windows Drive letters can be used to map shares. ("X;Y;Z") ',
	},
	temporaryFolderPath: {
		type: 'string',
		default: process.env.WORKER_TEMPORARY_FOLDER_PATH || '',
		describe: 'A temporary, local file path where the worker can store temporary artifacts',
	},
	allowedExpectationTypes: {
		type: 'string',
		default: process.env.WORKER_ALLOWED_EXPECTATION_TYPES || '',
		describe: `A semicolon-separated list of allowed expectation types for this worker. Allowed options are: ${Object.values<string>(
			Expectation.Type
		).join(', ')}. (Empty means "all types are allowed")`,
	},
	resourceId: {
		type: 'string',
		default: process.env.WORKER_NETWORK_ID || 'default',
		describe: 'Identifier of the local resource/computer this worker runs on',
	},
	networkIds: {
		type: 'string',
		default: process.env.WORKER_NETWORK_ID || 'default',
		describe: 'List of identifiers of the local networks this worker has access to. ("networkA;networkB")',
	},
	costMultiplier: {
		type: 'number',
		default: process.env.WORKER_COST_MULTIPLIER || 1,
		describe: 'Multiply the cost of the worker with this',
	},
	considerCPULoad: {
		type: 'number',
		default: process.env.WORKER_CONSIDER_CPU_LOAD || '',
		describe:
			'If set, the worker will consider the CPU load of the system it runs on before it accepts jobs. Set to a value between 0 and 1, the worker will accept jobs if the CPU load is below the configured value.',
	},

	failurePeriodLimit: {
		type: 'number',
		default: parseInt(process.env.WORKER_FAILURE_PERIOD_LIMIT || '', 10) || 0,
		describe:
			'If set, the worker will count the number of periods of time where it encounters errors while working and will restart once the number of consequent periods of time is exceeded.',
	},
	failurePeriod: {
		type: 'number',
		default: parseInt(process.env.WORKER_FAILURE_PERIOD || '', 10) || 5 * 60 * 1000,
		describe: 'This is the period of time used by "failurePeriodLimit" (milliseconds)',
	},
	executableAliases: {
		type: 'string',
		default: process.env.WORKER_EXECUTABLE_ALIASES || '',
		describe:
			'List of aliases for executables the worker can use. Format: "alias1=path to executable1;alias2=executable2"',
	},
})
/** CLI-argument-definitions for the Worker process */
const workerArguments = defineArguments({
	workforceURL: {
		type: 'string',
		default: process.env.WORKFORCE_URL || 'ws://localhost:8070',
		describe: 'The URL to the Workforce',
	},
	appContainerURL: {
		type: 'string',
		default: process.env.APP_CONTAINER_URL || '', // 'ws://localhost:8090',
		describe: 'The URL to the AppContainer',
	},
	workerId: { type: 'string', default: process.env.WORKER_ID || 'worker0', describe: 'Unique id of the worker' },
	pickUpCriticalExpectationsOnly: {
		type: 'boolean',
		default: process.env.WORKER_PICK_UP_CRITICAL_EXPECTATIONS_ONLY === '1' || false,
		describe: 'If set to 1, the worker will only pick up expectations that are marked as critical for playout.',
	},

	...workerArgumentsGeneric,
})
/** CLI-argument-definitions for the AppContainer process */
const appContainerArguments = defineArguments({
	appContainerId: {
		type: 'string',
		default: process.env.APP_CONTAINER_ID || 'appContainer0',
		describe: 'Unique id of the appContainer',
	},
	workforceURL: {
		type: 'string',
		default: process.env.WORKFORCE_URL || 'ws://localhost:8070',
		describe: 'The URL to the Workforce',
	},
	port: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_PORT || '', 10) || 8090,
		describe: 'The port number to start the App Container websocket server on',
	},
	maxRunningApps: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_MAX_RUNNING_APPS || '', 10) || 3,
		describe: 'How many apps the appContainer can run at the same time',
	},
	minRunningApps: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_MIN_RUNNING_APPS || '', 10) || 1,
		describe: 'Minimum amount of apps (of a certain appType) to be running',
	},
	maxAppKeepalive: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_MAX_APP_KEEPALIVE || '', 10) || 6 * 3600 * 1000, // ms (6 hours)
		describe: 'Maximum time an app will be kept running',
	},
	spinDownTime: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_SPIN_DOWN_TIME || '', 10) || 60 * 1000, // ms (1 minute)
		describe: 'How long a Worker should stay idle before attempting to be spun down',
	},
	minCriticalWorkerApps: {
		type: 'number',
		default: 1,
		describe: 'Number of Workers reserved for fulfilling playout-critical expectations that will be kept running',
	},

	// These are passed-through to the spun-up workers:
	...workerArgumentsGeneric,
})
/** CLI-argument-definitions for the "Single" process */
const singleAppArguments = defineArguments({
	noHTTPServers: {
		type: 'boolean',
		default: process.env.NO_HTTP_SERVERS === '1',
		describe: 'If set, the app will not start the HTTP servers',
	},
	workerCount: {
		type: 'number',
		default: parseInt(process.env.WORKER_COUNT || '', 10) || 1,
		describe: 'How many workers to spin up',
	},
	workforcePort: {
		type: 'number',
		// 0 = Set the workforce port to whatever is available
		default: parseInt(process.env.WORKFORCE_PORT || '', 10) || 0,
		describe: 'The port number to start the Workforce websocket server on',
	},
})
/** CLI-argument-definitions for the Quantel-HTTP-Transformer-Proxy process */
const quantelHTTPTransformerProxyConfigArguments = defineArguments({
	quantelProxyPort: {
		type: 'number',
		default: parseInt(process.env.QUANTEL_HTTP_TRANSFORMER_PROXY_PORT || '', 10) || 8081,
		describe: 'The port on which to server the Quantel-HTTP-Transformer-Proxy server on',
	},
	quantelTransformerURL: {
		type: 'string',
		default: process.env.QUANTEL_HTTP_TRANSFORMER_URL || undefined,
		describe: 'URL to the Quantel-HTTP-Transformer',
	},

	quantelTransformerRateLimitDuration: {
		type: 'number',
		default: parseInt(process.env.QUANTEL_HTTP_TRANSFORMER_RATE_LIMIT_DURATION || '', 10) || undefined,
		describe: 'Rate Limit Duration for the Quantel-HTTP-Transformer [ms]',
	},
	quantelTransformerRateLimitMax: {
		type: 'number',
		default: parseInt(process.env.QUANTEL_HTTP_TRANSFORMER_RATE_LIMIT_MAX || '', 10) || undefined,
		describe: 'Rate Limit Max for the Quantel-HTTP-Transformer',
	},
})

export interface ProcessConfig {
	logPath: string | undefined
	logLevel: string | undefined
	/** Will cause the Node app to blindly accept all certificates. Not recommenced unless in local, controlled networks. */
	unsafeSSL: boolean
	/** Paths to certificates to load, for SSL-connections */
	certificates: string[]
}
export function getProcessConfig(argv: {
	logPath: string | undefined
	logLevel: string | undefined
	unsafeSSL: boolean
	certificates: string | undefined
}): ProcessConfig {
	const certs: string[] = (argv.certificates || process.env.CERTIFICATES || '').split(';') || []
	return {
		logPath: argv.logPath,
		logLevel: argv.logLevel,
		unsafeSSL: argv.unsafeSSL,
		certificates: _.compact(certs),
	}
}
// Configuration for the Workforce Application: ------------------------------
export interface WorkforceConfig {
	process: ProcessConfig
	workforce: {
		port: number | null
		allowNoAppContainers: boolean
	}
}

export async function getWorkforceConfig(): Promise<WorkforceConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...workforceArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		workforce: {
			port: argv.port,
			allowNoAppContainers: argv.allowNoAppContainers,
		},
	}
}
// Configuration for the HTTP server Application: ----------------------------------
export interface HTTPServerConfig {
	process: ProcessConfig
	httpServer: {
		port: number

		basePath: string
		apiKeyRead: string | undefined
		apiKeyWrite: string | undefined
		/** Clean up (remove) files older than this age (in seconds). 0 or -1 means that it's disabled. */
		cleanFileAge: number
	}
}
export async function getHTTPServerConfig(): Promise<HTTPServerConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...httpServerArguments,
			...processOptions,
		}).argv
	)

	if (!argv.apiKeyWrite && argv.apiKeyRead) {
		throw new Error(`Error: When apiKeyRead is given, apiKeyWrite is required!`)
	}

	return {
		process: getProcessConfig(argv),
		httpServer: {
			port: argv.httpServerPort,
			basePath: argv.basePath,
			apiKeyRead: argv.apiKeyRead,
			apiKeyWrite: argv.apiKeyWrite,
			cleanFileAge: argv.cleanFileAge,
		},
	}
}
// Configuration for the Package Manager Application: ------------------------------
export interface PackageManagerConfig {
	process: ProcessConfig
	packageManager: {
		coreHost: string
		corePort: number
		deviceId: string
		deviceToken: string
		disableWatchdog: boolean

		port: number | null
		accessURLs: URLMap | null
		workforceURL: string | null

		watchFiles: boolean
		noCore: boolean
		chaosMonkey: boolean
		concurrency?: number
	}
}
export async function getPackageManagerConfig(): Promise<PackageManagerConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...packageManagerArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		packageManager: {
			coreHost: argv.coreHost,
			corePort: argv.corePort,
			deviceId: argv.deviceId,
			deviceToken: argv.deviceToken,
			disableWatchdog: argv.disableWatchdog,

			port: argv.port,
			accessURLs: parseNetworkScopedURLs(argv.accessURL),
			workforceURL: argv.workforceURL,

			watchFiles: argv.watchFiles,
			noCore: argv.noCore,
			chaosMonkey: argv.chaosMonkey,
			concurrency: argv.concurrency,
		},
	}
}
// Configuration for the Worker Application: ------------------------------
export interface WorkerConfig {
	process: ProcessConfig
	worker: {
		workforceURL: string | null
		appContainerURL: string | null
		workerId: WorkerAgentId
		/** If true, the worker will only pick up expectations that are marked as "critical" */
		pickUpCriticalExpectationsOnly: boolean
		allowedExpectationTypes: string[] | null
		failurePeriodLimit: number
		failurePeriod: number
	} & WorkerAgentConfig
}
export async function getWorkerConfig(): Promise<WorkerConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...workerArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		worker: {
			workforceURL: argv.workforceURL,
			appContainerURL: argv.appContainerURL,
			workerId: protectString<WorkerAgentId>(argv.workerId),
			pickUpCriticalExpectationsOnly: parseArgBoolean(argv.pickUpCriticalExpectationsOnly) ?? false,

			sourcePackageStabilityThreshold: parseArgInteger(argv.sourcePackageStabilityThreshold),
			windowsDriveLetters: parseArgStringList(argv.windowsDriveLetters),
			temporaryFolderPath: argv.temporaryFolderPath ? argv.temporaryFolderPath : undefined,
			allowedExpectationTypes: parseArgStringList(argv.allowedExpectationTypes, null),
			resourceId: argv.resourceId,
			networkIds: parseArgStringList(argv.networkIds),
			costMultiplier: parseArgFloat(argv.costMultiplier) ?? 1,
			considerCPULoad: parseArgFloat(argv.considerCPULoad) ?? null,
			failurePeriodLimit: parseArgInteger(argv.failurePeriodLimit) ?? 0,
			failurePeriod: parseArgInteger(argv.failurePeriod) ?? 0,
			executableAliases: parseExecutableAliases(argv.executableAliases),
		},
	}
}
// Configuration for the AppContainer Application: ------------------------------
export interface AppContainerProcessConfig {
	process: ProcessConfig
	appContainer: AppContainerConfig
}
export async function getAppContainerConfig(): Promise<AppContainerProcessConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...appContainerArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		appContainer: {
			workforceURL: argv.workforceURL,
			port: argv.port,
			appContainerId: protectString<AppContainerId>(argv.appContainerId),
			maxRunningApps: argv.maxRunningApps,
			minRunningApps: argv.minRunningApps,
			maxAppKeepalive: argv.maxAppKeepalive,
			spinDownTime: argv.spinDownTime,
			minCriticalWorkerApps: argv.minCriticalWorkerApps,

			worker: {
				sourcePackageStabilityThreshold: parseArgInteger(argv.sourcePackageStabilityThreshold),
				windowsDriveLetters: parseArgStringList(argv.windowsDriveLetters),
				temporaryFolderPath: argv.temporaryFolderPath ? argv.temporaryFolderPath : undefined,
				allowedExpectationTypes: parseArgStringList(argv.allowedExpectationTypes, null),
				resourceId: argv.resourceId,
				networkIds: parseArgStringList(argv.networkIds),
				costMultiplier: parseArgFloat(argv.costMultiplier) ?? 1,
				considerCPULoad: parseArgFloat(argv.considerCPULoad) ?? null,
				failurePeriodLimit: parseArgInteger(argv.failurePeriodLimit) ?? 0,
				failurePeriod: parseArgInteger(argv.failurePeriod) ?? 0,
				executableAliases: parseExecutableAliases(argv.executableAliases),
			},
		},
	}
}

// Configuration for the Single-app Application: ------------------------------
export interface SingleAppConfig
	extends WorkforceConfig,
		HTTPServerConfig,
		PackageManagerConfig,
		WorkerConfig,
		AppContainerProcessConfig,
		QuantelHTTPTransformerProxyConfig {
	singleApp: {
		noHTTPServers: boolean
		workerCount: number
		workforcePort: number
	}
}

export async function getSingleAppConfig(): Promise<SingleAppConfig> {
	const options = {
		...workforceArguments,
		...httpServerArguments,
		...packageManagerArguments,
		...workerArguments,
		...processOptions,
		...singleAppArguments,
		...appContainerArguments,
		...quantelHTTPTransformerProxyConfigArguments,
	}
	// Remove some that are not used in the Single-App, so that they won't show up when running '--help':

	// @ts-expect-error not optional
	delete options.corePort
	// @ts-expect-error not optional
	delete options.accessUrl
	// @ts-expect-error not optional
	delete options.workforceURL
	// @ts-expect-error not optional
	delete options.port

	const argv = await Promise.resolve(yargs(getProcessArgv()).options(options).argv)

	return {
		process: getProcessConfig(argv),
		workforce: (await getWorkforceConfig()).workforce,
		httpServer: (await getHTTPServerConfig()).httpServer,
		packageManager: (await getPackageManagerConfig()).packageManager,
		worker: (await getWorkerConfig()).worker,
		singleApp: {
			noHTTPServers: argv.noHTTPServers ?? false,
			workerCount: argv.workerCount || 1,
			workforcePort: argv.workforcePort,
		},
		appContainer: (await getAppContainerConfig()).appContainer,
		quantelHTTPTransformerProxy: (await getQuantelHTTPTransformerProxyConfig()).quantelHTTPTransformerProxy,
	}
}
// Configuration for the HTTP server Application: ----------------------------------
export interface QuantelHTTPTransformerProxyConfig {
	process: ProcessConfig
	quantelHTTPTransformerProxy: {
		port: number

		transformerURL?: string

		rateLimitDuration?: number
		rateLimitMax?: number
	}
}
export async function getQuantelHTTPTransformerProxyConfig(): Promise<QuantelHTTPTransformerProxyConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...quantelHTTPTransformerProxyConfigArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		quantelHTTPTransformerProxy: {
			port: argv.quantelProxyPort,
			transformerURL: argv.quantelTransformerURL,
			rateLimitDuration: argv.quantelTransformerRateLimitDuration,
			rateLimitMax: argv.quantelTransformerRateLimitMax,
		},
	}
}
// ---------------------------------------------------------------------------------

/** Helper function, to get strict typings for the yargs-Options. */
export function defineArguments<O extends { [key: string]: Options }>(opts: O): O {
	return opts
}

export function getProcessArgv(): string[] {
	// Note: process.argv typically looks like this:
	// [
	// 	'C:\\Program Files\\nodejs\\node.exe',
	// 	'C:\\path\\to\\my\\package-manager\\apps\\single-app\\app\\dist\\index.js',
	// 	'--',
	// 	'--watchFiles=true',
	// 	'--noCore=true',
	// 	'--logLevel=debug'
	// ]

	// Remove the first two arguments
	let args = process.argv.slice(2)

	// If the first argument is just '--', remove it:
	if (args[0] === '--') args = args.slice(1)

	// Fix an issue when arguments are escaped and contains spaces:

	// for example: --myArg="this is hard" becomes ['--myArg="this', 'is', 'hard"']
	for (let i = 0; i < args.length; i++) {
		const m = args[i].match(/=*(["'])/)
		if (m) {
			const quote = m[1] // " or '

			// check if the arg contains only one quote
			if (countOccurrences(args[i], quote) !== 1) continue

			// check future args
			let argCombined = args[i]

			for (let j = i + 1; j < args.length; j++) {
				argCombined += ' ' + args[j]
				if (args[j].includes(quote)) {
					// Found the end
					//
					// Combine the args in between and remove used args:
					args[i] = argCombined
					args.splice(i + 1, j - i)
					break
				}
			}
		}
	}

	return args
}

/**
 * Parses a string of executable aliases into an object.
 * The string should be in the format alias1=executable1;alias2=executable2
 */
function parseArgStringList<T = never[]>(str: unknown, fallback: any = []): string[] | T {
	if (typeof str === 'string') {
		return str.split(';')
	}

	return fallback
}

/**
 * Parses a string of networked-scoped URLs into a URLMap - an object with at least a '*' key for the fallback URL.
 * The string should be in the format network1@schema:host;network2@schema://host;schema:host.public
 */
export function parseNetworkScopedURLs(str: unknown): URLMap | null {
	if (typeof str === 'string' && str.startsWith('"') && str.endsWith('"')) {
		// the string is escaped
		try {
			str = JSON.parse(str)
		} catch {
			// ignore parse errors
		}
	}

	const accessURLs: URLMap = {
		'*': '',
	}

	let fallBackURL: string | null = null

	if (typeof str !== 'string' || str.length === 0) return null

	str.split(';').forEach((networkIdAndURLPair: string) => {
		let [networkId, url] = networkIdAndURLPair.split('@', 2)
		if (!url) {
			url = networkId
			networkId = '*'
		}

		if (networkId === '*' || !fallBackURL) {
			fallBackURL = url
		}
		accessURLs[networkId] = url
	})

	if (fallBackURL === null) {
		// this will never happen, but for type safety:
		throw new Error(`Error: At least one accessURL must be specified!`)
	}

	accessURLs['*'] = fallBackURL

	return accessURLs
}

/**
 * Parses a string of executable aliases into an object.
 * The string should be in the format alias1=executable1;alias2=executable2
 */
export function parseExecutableAliases(str: unknown): { [alias: string]: string } {
	if (typeof str === 'string' && str.startsWith('"') && str.endsWith('"')) {
		// the string is escaped
		try {
			str = JSON.parse(str)
		} catch {
			// ignore parse errors
		}
	}

	if (typeof str === 'string') {
		const result: { [alias: string]: string } = {}

		const statements = str.split(';')

		for (const statement of statements) {
			const words = statement.split('=')
			if (words.length !== 2) continue

			const alias = words[0]
			const executable = words[1]

			if (alias && executable) {
				result[alias] = executable
			}
		}

		return result
	}

	return {}
}

function parseArgInteger(str: unknown): number | undefined {
	if (!str) return undefined

	const int = typeof str === 'number' ? str : typeof str === 'string' ? parseInt(str, 20) : undefined
	if (Number.isNaN(int) || !int) return undefined

	return int
}

function parseArgFloat(str: unknown): number | undefined {
	if (!str) return undefined

	const int = typeof str === 'number' ? str : typeof str === 'string' ? parseFloat(str) : undefined
	if (Number.isNaN(int) || !int) return undefined

	return int
}
function parseArgBoolean(str: unknown): boolean | undefined {
	if (typeof str === 'number') {
		return str !== 0
	}
	if (typeof str === 'string') {
		if (str === 'true') return true
		if (str === '1') return true

		if (str === 'false') return false
		if (str === '0') return false
	}
	return undefined
}
