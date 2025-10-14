import {
	LoggerInstance,
	AppContainerProcessConfig,
	ClientConnectionOptions,
	LogLevel,
	WebsocketServer,
	ClientConnection,
	AppContainerWorkerAgent,
	assertNever,
	Expectation,
	PackageContainerExpectation,
	Reason,
	stringifyError,
	setLogLevel,
	INNER_ACTION_TIMEOUT,
	DataStore,
	literal,
	WorkForceAppContainer,
	mapEntries,
	findValue,
	AppContainerId,
	AppType,
	AppId,
	WorkerAgentId,
	unprotectString,
	DataId,
	LockId,
	protectString,
	Cost,
} from '@sofie-package-manager/api'

import { WorkforceAPI } from '@appcontainer-node/generic/dist/workforceApi' // TODO - refine this?
import { WorkerAgentAPI } from '@appcontainer-node/generic/dist/workerAgentApi' // TODO - refine this?
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'

const WORKER_DATA_LOCK_TIMEOUT = INNER_ACTION_TIMEOUT

const APP_TYPE_WORKER = protectString<AppType>('worker')
const ALL_APP_TYPES = [APP_TYPE_WORKER]

export class AppContainer {
	private workforceAPI: WorkforceAPI
	private id: AppContainerId
	private workForceConnectionOptions: ClientConnectionOptions

	private apps: Map<AppId, RunningAppInfo> = new Map()
	private websocketServer?: WebsocketServer

	private initWorkForceApiPromise?: { resolve: () => void; reject: (reason: any) => void }

	/**
	 * The WorkerStorage is a storage that the workers can use to reliably store and read data.
	 * It is a key-value store, with support for access locks (so that only one worker can write to a key at a time).
	 */
	private workerStorage: DataStore

	private logger: LoggerInstance

	constructor(logger: LoggerInstance, private config: AppContainerProcessConfig) {
		this.logger = logger.category('AppContainer')
		this.id = config.appContainer.appContainerId

		this.workerStorage = new DataStore(this.logger, WORKER_DATA_LOCK_TIMEOUT)

		if (!config.appContainer.port)
			throw new Error('AppContainer: No port configured for AppContainer websocket server')

		this.websocketServer = new WebsocketServer(
			config.appContainer.port,
			this.logger,
			(client: ClientConnection) => {
				try {
					// A new client has connected

					this.logger.debug(`New client "${client.clientType}" connected, id "${client.clientId}"`)

					const connectionId = String(Math.random()) // TODO - more comparable id?

					switch (client.clientType) {
						case 'workerAgent': {
							const clientId = client.clientId as WorkerAgentId
							const workForceMethods = this.getWorkerAgentAPI(clientId)
							const api = new WorkerAgentAPI(this.id, workForceMethods, {
								type: 'websocket',
								clientConnection: client,
							})
							let app = this.apps.get(clientId)
							if (app) {
								this.logger.info(`New connection from Worker "${client.clientId}" established`)
								app.workerAgentApi = api
								app.connectionId = connectionId
							} else {
								this.logger.info(`Connection from new Worker "${client.clientId}" established`)
								app = {
									appType: APP_TYPE_WORKER,
									isOnlyForCriticalExpectations: false,
									monitorPing: false,
									lastPing: Date.now(),
									workerAgentApi: api,
									start: Date.now(),

									connectionId,
								}
								this.apps.set(clientId, app)
							}
							client.once('close', () => {
								this.logger.warn(`Connection from Worker "${clientId}" closed`)

								// Cleanup the app if it is still the same connection:
								const app = this.apps.get(clientId)
								if (app && app.connectionId == connectionId) {
									this.apps.delete(clientId)
								}

								this.workerStorage.releaseLockForTag(unprotectString(clientId))
							})
							this.logger.info(`Connection from Worker "${client.clientId}" established`)
							app.workerAgentApi = api

							// Set upp the app for pinging and automatic spin-down:
							app.monitorPing = true
							app.lastPing = Date.now()
							api.setSpinDownTime(0).catch((err) => {
								// TODO - is this correct time?
								this.logger.error(`Error in spinDownTime: ${stringifyError(err)}`)
							})
							break
						}
						case 'expectationManager':
						case 'appContainer':
						case 'N/A':
							throw new Error(`ExpectationManager: Unsupported clientType "${client.clientType}"`)
						default:
							assertNever(client.clientType)
							throw new Error(`Workforce: Unknown clientType "${client.clientType}"`)
					}
				} catch (error) {
					this.logger.error(stringifyError(error))
				}
			}
		)
		this.websocketServer.on('error', (err: unknown) => {
			this.logger.error(`WebsocketServer error: ${stringifyError(err)}`)
		})
		this.websocketServer.on('close', () => {
			this.logger.error(`WebsocketServer closed`)
		})

		this.workforceAPI = new WorkforceAPI(this.id, this.logger)
		this.workforceAPI.on('disconnected', () => {
			this.logger.warn('Workforce disconnected')
		})
		this.workforceAPI.on('connected', () => {
			this.logger.info('Workforce connected')

			this.workforceAPI
				.registerAvailableApps(ALL_APP_TYPES.map((appType) => ({ appType })))
				.then(() => {
					this.initWorkForceApiPromise?.resolve() // To finish the init() function
				})
				.catch((err) => {
					this.logger.error(`Error in registerAvailableApps: ${stringifyError(err)}`)
					this.initWorkForceApiPromise?.reject(err)
				})
		})
		this.workforceAPI.on('error', (err) => {
			this.logger.error(`WorkforceAPI error event: ${stringifyError(err)}`)
		})

		this.workForceConnectionOptions = this.config.appContainer.workforceURL
			? {
					type: 'websocket',
					url: this.config.appContainer.workforceURL,
			  }
			: {
					type: 'internal',
			  }

		process.on('exit', (code) => {
			this.logger.info(`Closing with exitCode ${code}`)
			this.websocketServer?.terminate()
			this.killAllApps()
		})
	}
	async init(): Promise<void> {
		if (this.workForceConnectionOptions.type === 'websocket') {
			this.logger.info(`Connecting to Workforce at "${this.workForceConnectionOptions.url}"`)
		}

		await this.workforceAPI.init(
			this.workForceConnectionOptions,
			literal<Omit<WorkForceAppContainer.AppContainer, 'id'>>({
				setLogLevel: this.setLogLevel.bind(this),
				_debugKill: this._debugKill.bind(this),
				_debugSendKillConnections: this._debugSendKillConnections.bind(this),
				requestAppTypeForExpectation: this.requestAppTypeForExpectation.bind(this),
				requestAppTypeForPackageContainer: this.requestAppTypeForPackageContainer.bind(this),
				spinUp: async () => {
					throw new Error('Not supported')
				},
				spinDown: async () => {
					// Not supported
				},
				getRunningApps: this.getRunningApps.bind(this),
			})
		)
		if (!this.workforceAPI.connected) throw new Error('Workforce not connected')

		// Wait for the this.workforceAPI to be ready before continuing:
		await new Promise<void>((resolve, reject) => {
			this.initWorkForceApiPromise = { resolve, reject }
		})

		this.logger.info(`Initialized`)
	}
	/** Return the API-methods that the AppContainer exposes to the WorkerAgent */
	private getWorkerAgentAPI(clientId: WorkerAgentId): AppContainerWorkerAgent.AppContainer {
		return {
			id: clientId,
			ping: async (): Promise<void> => {
				const app = this.apps.get(clientId)
				if (app) app.lastPing = Date.now()
			},
			requestSpinDown: async (_force?: boolean): Promise<void> => {
				this.logger.error(`Worker requested unsupported spin down: "${clientId}"`)
			},
			workerStorageWriteLock: async (
				dataId: DataId,
				customTimeout?: number
			): Promise<{ lockId: LockId; current: any | undefined }> => {
				return this.workerStorage.getWriteLock(dataId, customTimeout, unprotectString(clientId))
			},
			workerStorageReleaseLock: async (dataId: DataId, lockId: LockId): Promise<void> => {
				return this.workerStorage.releaseLock(dataId, lockId)
			},
			workerStorageWrite: async (dataId: DataId, lockId: LockId, data: string): Promise<void> => {
				return this.workerStorage.write(dataId, lockId, data)
			},
			workerStorageRead: async (dataId: DataId): Promise<any> => {
				return this.workerStorage.read(dataId)
			},
		}
	}

	terminate(): void {
		this.workforceAPI.terminate()
		this.websocketServer?.terminate()
		this.workerStorage.terminate()

		// kill child processes
	}
	async setLogLevel(logLevel: LogLevel): Promise<void> {
		this.logger.info(`Setting log level to "${logLevel}"`)
		setLogLevel(logLevel)
	}
	async _debugKill(): Promise<void> {
		// This is for testing purposes only
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(42)
		}, 1)
	}
	/** FOR DEBUGGING ONLY. Cut websocket connections, in order to ensure that they are restarted */
	async _debugSendKillConnections(): Promise<void> {
		this.workforceAPI.debugCutConnection()
	}

	/**
	 * Called when no worker is picking up an Expectation, to see if one can be started to handle it
	 */
	async requestAppTypeForExpectation(
		exp: Expectation.Any
	): Promise<{ success: true; appType: AppType; cost: Cost } | { success: false; reason: Reason }> {
		this.logger.debug(`Got request for resources, for exp "${exp.id}"`)

		let lastNotSupportReason: ExpectedPackageStatusAPI.Reason = {
			user: 'No apps available',
			tech: 'No apps available',
		}

		for (const appType of ALL_APP_TYPES) {
			const runningApp = await this.getRunningApp(appType)

			if (runningApp?.workerAgentApi) {
				const result = await runningApp.workerAgentApi.doYouSupportExpectation(exp)
				if (result.support) {
					return {
						success: true,
						appType: appType,
						cost: 0,
					}
				} else {
					lastNotSupportReason = result.reason
					this.logger.silly(
						`App "${appType}": Does not support the expectation, reason: "${result.reason.tech}"`
					)
				}
			} else {
				this.logger.warn(`appType "${appType}" not available`)
			}
		}
		return {
			success: false,
			reason: {
				user: `No worker supports this expectation (reason: ${lastNotSupportReason?.user})`,
				tech: `No worker supports this expectation (one reason: ${lastNotSupportReason?.tech})`,
			},
		}
	}

	/**
	 * Called when no worker is handling something?, to see if one can be started to handle it
	 */
	async requestAppTypeForPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<{ success: true; appType: AppType; cost: Cost } | { success: false; reason: Reason }> {
		this.logger.debug(`Got request for resources, for packageContainer "${packageContainer.id}"`)

		for (const appType of ALL_APP_TYPES) {
			const runningApp = await this.getRunningApp(appType)

			if (runningApp?.workerAgentApi) {
				const result = await runningApp.workerAgentApi.doYouSupportPackageContainer(packageContainer)
				if (result.support) {
					return {
						success: true,
						appType: appType,
						cost: 0,
					}
				}
			} else {
				this.logger.warn(`appType "${appType}" not available`)
			}
		}
		return {
			success: false,
			reason: {
				user: `No worker supports this packageContainer`,
				tech: `No worker supports this packageContainer`,
			},
		}
	}

	private async getRunningApp(appType: AppType): Promise<RunningAppInfo | undefined> {
		// Do we already have any instance of the appType running?
		return findValue(this.apps, (_, app) => app.appType === appType)
	}

	/** This is used to kill all ChildProcesses when terminating */
	private killAllApps() {
		this.apps.forEach((app) => {
			app.workerAgentApi.close().catch((err) => {
				this.logger.error(`Error closing WorkerAgentAPI: ${stringifyError(err)}`)
			})
		})
		this.apps.clear()
	}
	async getRunningApps(): Promise<{ appId: AppId; appType: AppType }[]> {
		return mapEntries(this.apps, (appId, app) => {
			return {
				appId: appId,
				appType: app.appType,
			}
		})
	}
}

interface RunningAppInfo {
	appType: AppType
	/** Set to true if the app is only handling playout-critical expectations */
	isOnlyForCriticalExpectations: boolean
	/** If null, there is no websocket connection to the app */
	workerAgentApi: WorkerAgentAPI
	monitorPing: boolean
	lastPing: number
	start: number

	/** An id for the websocket connection, to ensure that a reconnect doesn't get stuck in a closed state */
	connectionId: string
}
