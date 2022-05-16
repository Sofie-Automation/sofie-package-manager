import * as cp from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import _ from 'underscore'
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
	waitTime,
	APPCONTAINER_PING_TIME,
	APPCONTAINER_MAX_KEEPALIVE,
	PackageContainerExpectation,
	Reason,
	stringifyError,
	LeveledLogMethod,
	setLogLevel,
	isNodeRunningInDebugMode,
} from '@shared/api'
import { WorkforceAPI } from './workforceApi'
import { WorkerAgentAPI } from './workerAgentApi'

/** Mimimum time between app restarts */
const RESTART_COOLDOWN = 60 * 1000 // ms

export class AppContainer {
	private workforceAPI: WorkforceAPI
	private id: string
	private workForceConnectionOptions: ClientConnectionOptions
	private appId = 0
	private usedInspectPorts = new Set<number>()
	private busyPorts = new Set<number>()

	private apps: {
		[appId: string]: {
			process: cp.ChildProcess
			appType: string
			toBeKilled: boolean
			restarts: number
			lastRestart: number
			spinDownTime: number
			/** If null, there is no websocket connection to the app */
			workerAgentApi: WorkerAgentAPI | null
			monitorPing: boolean
			lastPing: number
			start: number
		}
	} = {}
	private availableApps: {
		[appType: string]: AvailableAppInfo
	} = {}
	private websocketServer?: WebsocketServer

	private monitorAppsTimer: NodeJS.Timer | undefined
	private initWorkForceApiPromise?: { resolve: () => void; reject: (reason: any) => void }

	private logger: LoggerInstance

	constructor(logger: LoggerInstance, private config: AppContainerProcessConfig) {
		this.logger = logger.category('AppContainer')
		if (config.appContainer.port !== null) {
			this.websocketServer = new WebsocketServer(
				config.appContainer.port,
				this.logger,
				(client: ClientConnection) => {
					// A new client has connected

					this.logger.debug(`New client "${client.clientType}" connected, id "${client.clientId}"`)

					switch (client.clientType) {
						case 'workerAgent': {
							const workForceMethods = this.getWorkerAgentAPI(client.clientId)
							const api = new WorkerAgentAPI(workForceMethods, {
								type: 'websocket',
								clientConnection: client,
							})
							const app = this.apps[client.clientId]
							if (!app) {
								throw new Error(`Unknown app "${client.clientId}" just connected to the appContainer`)
							}
							client.once('close', () => {
								this.logger.warn(`Connection to Worker "${client.clientId}" closed`)
								app.workerAgentApi = null
							})
							this.logger.info(`Connection to Worker "${client.clientId}" established`)
							app.workerAgentApi = api

							// Set upp the app for pinging and automatic spin-down:
							app.monitorPing = true
							app.lastPing = Date.now()
							api.setSpinDownTime(app.spinDownTime).catch((err) => {
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
				}
			)
			this.websocketServer.on('error', (err: unknown) => {
				this.logger.error(`WebsocketServer error: ${stringifyError(err)}`)
			})
			this.websocketServer.on('close', () => {
				this.logger.error(`WebsocketServer closed`)
			})
		}

		this.workforceAPI = new WorkforceAPI(this.logger)
		this.workforceAPI.on('disconnected', () => {
			this.logger.warn('Workforce disconnected')
		})
		this.workforceAPI.on('connected', () => {
			this.logger.info('Workforce connected')

			this.workforceAPI
				.registerAvailableApps(
					Object.entries(this.availableApps).map((o) => {
						const appType = o[0] as string
						return {
							appType: appType,
						}
					})
				)
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

		this.id = config.appContainer.appContainerId
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
			this.killAllApps()
		})
	}
	async init(): Promise<void> {
		await this.setupAvailableApps()

		if (this.workForceConnectionOptions.type === 'websocket') {
			this.logger.info(`Connecting to Workforce at "${this.workForceConnectionOptions.url}"`)
		}

		await this.workforceAPI.init(this.id, this.workForceConnectionOptions, this)
		if (!this.workforceAPI.connected) throw new Error('Workforce not connected')

		this.monitorAppsTimer = setInterval(() => {
			this.monitorApps()
		}, APPCONTAINER_PING_TIME)
		this.monitorApps() // Also run right away

		// Wait for the this.workforceAPI to be ready before continuing:
		await new Promise<void>((resolve, reject) => {
			this.initWorkForceApiPromise = { resolve, reject }
		})

		this.logger.info(`Initialized"`)
	}
	/** Return the API-methods that the AppContainer exposes to the WorkerAgent */
	private getWorkerAgentAPI(clientId: string): AppContainerWorkerAgent.AppContainer {
		return {
			ping: async (): Promise<void> => {
				this.apps[clientId].lastPing = Date.now()
			},
			requestSpinDown: async (): Promise<void> => {
				const app = this.apps[clientId]
				if (app) {
					if (this.getAppCount(app.appType) > this.config.appContainer.minRunningApps) {
						this.spinDown(clientId, `Requested by app`).catch((error) => {
							this.logger.error(`Error when spinning down app "${clientId}": ${stringifyError(error)}`)
						})
					}
				}
			},
		}
	}
	private getAppCount(appType: string): number {
		let count = 0
		for (const app of Object.values(this.apps)) {
			if (app.appType === appType) count++
		}
		return count
	}
	private async setupAvailableApps() {
		const getWorkerArgs = (appId: string): string[] => {
			return [
				`--workerId=${appId}`,
				`--workforceURL=${this.config.appContainer.workforceURL}`,
				`--appContainerURL=${'ws://127.0.0.1:' + this.websocketServer?.port}`,

				this.config.process.unsafeSSL ? '--unsafeSSL=true' : '',
				this.config.process.certificates.length
					? `--certificates=${this.config.process.certificates.join(';')}`
					: '',

				this.config.appContainer.worker.windowsDriveLetters
					? `--windowsDriveLetters=${this.config.appContainer.worker.windowsDriveLetters?.join(';')}`
					: '',
				this.config.appContainer.worker.costMultiplier
					? `--costMultiplier=${this.config.appContainer.worker.costMultiplier}`
					: '',
				this.config.appContainer.worker.resourceId
					? `--resourceId=${this.config.appContainer.worker.resourceId}`
					: '',
				this.config.appContainer.worker.networkIds.length
					? `--networkIds=${this.config.appContainer.worker.networkIds.join(';')}`
					: '',
			]
		}
		if (process.execPath.match(/node.exe$/)) {
			// Process runs as a node process, we're probably in development mode.
			this.availableApps['worker'] = {
				file: process.execPath,
				args: (appId: string) => {
					return [path.resolve('.', '../../worker/app/dist/index.js'), ...getWorkerArgs(appId)]
				},
				cost: 0,
			}
		} else {
			// Process is a compiled executable
			// Look for the worker executable in the same folder:

			const dirPath = path.dirname(process.execPath)
			// Note: nexe causes issues with its virtual file system: https://github.com/nexe/nexe/issues/613#issuecomment-579107593

			;(await fs.promises.readdir(dirPath)).forEach((fileName) => {
				if (fileName.match(/worker/i)) {
					this.availableApps[fileName] = {
						file: path.join(dirPath, fileName),
						args: (appId: string) => {
							return [...getWorkerArgs(appId)]
						},
						cost: 0,
					}
				}
			})
		}
		this.logger.info(`Available apps`)
		for (const [appType, availableApp] of Object.entries(this.availableApps)) {
			this.logger.info(`${appType}: ${availableApp.file}`)
		}
	}
	terminate(): void {
		this.workforceAPI.terminate()
		this.websocketServer?.terminate()

		if (this.monitorAppsTimer) {
			clearInterval(this.monitorAppsTimer)
			delete this.monitorAppsTimer
		}

		// kill child processes
	}
	async setLogLevel(logLevel: LogLevel): Promise<void> {
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

	async requestAppTypeForExpectation(
		exp: Expectation.Any
	): Promise<{ success: true; appType: string; cost: number } | { success: false; reason: Reason }> {
		this.logger.debug(`Got request for resources, for exp "${exp.id}"`)
		if (Object.keys(this.apps).length >= this.config.appContainer.maxRunningApps) {
			this.logger.debug(`Is already at our limit, no more resources available`)
			// If we're at our limit, we can't possibly run anything else
			return {
				success: false,
				reason: {
					user: `Is already at limit (${this.config.appContainer.maxRunningApps})`,
					tech: `Is already at limit (${this.config.appContainer.maxRunningApps})`,
				},
			}
		}

		this.logger.debug(`Available apps: ${Object.keys(this.availableApps).join(', ')}`)

		for (const [appType, availableApp] of Object.entries(this.availableApps)) {
			// Do we already have any instance of the appType running?
			let runningApp = Object.values(this.apps).find((app) => {
				return app.appType === appType
			})

			if (!runningApp) {
				const newAppId = await this.spinUp(appType, true) // todo: make it not die too soon

				// wait for the app to connect to us:
				await tryAfewTimes(async () => {
					if (this.apps[newAppId].workerAgentApi) {
						return true
					}
					await waitTime(200)
					return false
				}, 10)
				runningApp = this.apps[newAppId]
				if (!runningApp) throw new Error(`Worker "${newAppId}" didn't connect in time`)
			}
			if (runningApp?.workerAgentApi) {
				const result = await runningApp.workerAgentApi.doYouSupportExpectation(exp)
				if (result.support) {
					return {
						success: true,
						appType: appType,
						cost: availableApp.cost,
					}
				}
			} else {
				this.logger.warn(`appType "${appType}" not available`)
			}
		}
		return {
			success: false,
			reason: {
				user: `No worker supports this expectation`,
				tech: `No worker supports this expectation`,
			},
		}
	}

	async requestAppTypeForPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<{ success: true; appType: string; cost: number } | { success: false; reason: Reason }> {
		this.logger.debug(`Got request for resources, for packageContainer "${packageContainer.id}"`)
		if (Object.keys(this.apps).length >= this.config.appContainer.maxRunningApps) {
			this.logger.debug(`Is already at our limit, no more resources available`)
			// If we're at our limit, we can't possibly run anything else
			return {
				success: false,
				reason: {
					user: `Is already at limit (${this.config.appContainer.maxRunningApps})`,
					tech: `Is already at limit (${this.config.appContainer.maxRunningApps})`,
				},
			}
		}

		this.logger.debug(`Available apps: ${Object.keys(this.availableApps).join(', ')}`)

		for (const [appType, availableApp] of Object.entries(this.availableApps)) {
			// Do we already have any instance of the appType running?
			let runningApp = Object.values(this.apps).find((app) => {
				return app.appType === appType
			})

			if (!runningApp) {
				const newAppId = await this.spinUp(appType, true) // todo: make it not die too soon

				// wait for the app to connect to us:
				await tryAfewTimes(async () => {
					if (this.apps[newAppId].workerAgentApi) {
						return true
					}
					await waitTime(200)
					return false
				}, 10)
				runningApp = this.apps[newAppId]
				if (!runningApp) throw new Error(`Worker "${newAppId}" didn't connect in time`)
			}
			if (runningApp?.workerAgentApi) {
				const result = await runningApp.workerAgentApi.doYouSupportPackageContainer(packageContainer)
				if (result.support) {
					return {
						success: true,
						appType: appType,
						cost: availableApp.cost,
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
	async spinUp(appType: string, longSpinDownTime = false): Promise<string> {
		const availableApp = this.availableApps[appType]
		if (!availableApp) throw new Error(`Unknown appType "${appType}"`)

		const appId = `${this.id}_${this.appId++}`

		this.logger.debug(`Spinning up app "${appId}" of type "${appType}"`)

		const child = this.setupChildProcess(appType, appId, availableApp)
		this.apps[appId] = {
			process: child,
			appType: appType,
			toBeKilled: false,
			restarts: 0,
			lastRestart: 0,
			monitorPing: false,
			lastPing: Date.now(),
			spinDownTime: this.config.appContainer.spinDownTime * (longSpinDownTime ? 10 : 1),
			workerAgentApi: null,
			start: Date.now(),
		}
		return appId
	}
	async spinDown(appId: string, reason: string): Promise<void> {
		const app = this.apps[appId]
		if (!app) throw new Error(`App "${appId}" not found`)

		this.logger.debug(`Spinning down app "${appId}" due to: ${reason}`)

		app.toBeKilled = true
		const success = app.process.kill()
		if (!success) throw new Error(`Internal error: Killing of process "${app.process.pid}" failed`)

		app.workerAgentApi = null
		app.process.removeAllListeners()
		delete this.apps[appId]
	}
	/** This is used to kill all ChildProcesses when terminating */
	private killAllApps() {
		Object.entries(this.apps).forEach(([appId, app]) => {
			app.toBeKilled = true
			const success = app.process.kill()
			if (!success)
				this.logger.error(`Internal error: App "${appId}" (PID: ${app.process.pid}) could not be killed`)

			app.workerAgentApi = null
			app.process.removeAllListeners()
		})
		this.apps = {}
	}
	async getRunningApps(): Promise<{ appId: string; appType: string }[]> {
		return Object.entries(this.apps).map((o) => {
			const [appId, app] = o

			return {
				appId: appId,
				appType: app.appType,
			}
		})
	}
	private setupChildProcess(appType: string, appId: string, availableApp: AvailableAppInfo): cp.ChildProcess {
		this.logger.debug(`Starting process "${appId}" (${appType}): "${availableApp.file}"`)
		const cwd = process.execPath.match(/node.exe$/)
			? undefined // Process runs as a node process, we're probably in development mode.
			: path.dirname(process.execPath) // Process runs as a node process, we're probably in development mode.

		let inspectPort: number | undefined = undefined
		if (isNodeRunningInDebugMode()) {
			// Also start child processes in debug mode:
			for (let i = 9100; i < 10000; i++) {
				if (!this.usedInspectPorts.has(i) && !this.busyPorts.has(i)) {
					inspectPort = i
					break
				}
			}
		}
		if (inspectPort) {
			this.logger.debug(`Child process will be started in debug mode with port ${inspectPort}`)
			this.usedInspectPorts.add(inspectPort)
		}

		const child = cp.spawn(availableApp.file, availableApp.args(appId), {
			cwd: cwd,
			env: {
				...process.env,
				NODE_OPTIONS: inspectPort ? `--inspect=127.0.0.1:${inspectPort}` : undefined,
			},
		})

		child.stdout.on('data', (message) => {
			this.logFromApp(appId, appType, message, this.logger.debug)
		})
		child.stderr.on('data', (message) => {
			this.logFromApp(appId, appType, message, this.logger.error)
			// this.logger.debug(`${appId} stderr: ${message}`)
		})
		child.once('exit', (code) => {
			if (inspectPort) this.usedInspectPorts.delete(inspectPort)
			const app = this.apps[appId]
			if (app && !app.toBeKilled) {
				// Try to restart the application

				const timeUntilRestart = Math.max(0, app.lastRestart - Date.now() + RESTART_COOLDOWN)
				this.logger.warn(
					`App ${app.process.pid} (${appType}) closed with code (${code}), trying to restart in ${timeUntilRestart} ms (restarts: ${app.restarts})`
				)

				setTimeout(() => {
					app.lastRestart = Date.now()
					app.restarts++

					app.process.removeAllListeners()

					const newChild = this.setupChildProcess(appType, appId, availableApp)

					app.process = newChild
				}, timeUntilRestart)
			}
		})

		return child
	}
	private monitorApps() {
		for (const [appId, app] of Object.entries(this.apps)) {
			if (app.monitorPing) {
				if (Date.now() - app.lastPing > APPCONTAINER_PING_TIME * 2.5) {
					// The app seems to have crashed.
					this.spinDown(appId, `Ping timeout`).catch((error) => {
						this.logger.error(`Error when spinning down app "${appId}": ${stringifyError(error)}`)
					})
				}
			}
			// try to avoid shutting down all workers at the same time
			const randomizeOffset = 2.5 * APPCONTAINER_PING_TIME * Math.random()
			if (Date.now() - app.start > APPCONTAINER_MAX_KEEPALIVE + randomizeOffset) {
				this.spinDown(appId, `Lifetime exceeded Max KeepAlive for apps: ${APPCONTAINER_MAX_KEEPALIVE}ms`).catch(
					(error) => {
						this.logger.error(`Error when spinning down app "${appId}": ${stringifyError(error)}`)
					}
				)
			}
		}
		this.spinUpMinimumApps().catch((error) => {
			this.logger.error(`Error in spinUpMinimumApps: ${stringifyError(error)}`)
		})
	}
	private async spinUpMinimumApps(): Promise<void> {
		for (const appType of Object.keys(this.availableApps)) {
			while (this.getAppCount(appType) < this.config.appContainer.minRunningApps) {
				await this.spinUp(appType)
			}
		}
	}
	private logFromApp(appId: string, appType: string, data: any, defaultLog: LeveledLogMethod): void {
		const messages = `${data}`.split('\n')

		for (const message of messages) {
			try {
				if (!message?.length) continue

				// Ignore some messages:
				if (message.indexOf('NODE_TLS_REJECT_UNAUTHORIZED') !== -1) {
					continue
				}

				// Handle an issue with busy ports:
				const m = `${message}`.match(/Starting inspector on 127.0.0.1:(\d+) failed/i)
				if (m) {
					const busyPort = parseInt(m[1])
					this.busyPorts.add(busyPort)
				}

				const json = JSON.parse(`${message}`)

				if (typeof json === 'object') {
					const logFcn =
						json.level === 'error'
							? this.logger.error
							: json.level === 'warn'
							? this.logger.warn
							: json.level === 'info'
							? this.logger.info
							: defaultLog

					const messageData = _.omit(json, ['message', 'localTimestamp', 'level'])

					logFcn(
						`App "${appId}" (${appType}): ${json.message}`,
						_.isEmpty(messageData) ? undefined : messageData
					)
				}
			} catch (err) {
				// There was an error parsing the message (the probably message wasn't JSON).

				defaultLog(`${appId} stdout: ${message}`)
			}
		}
	}
}
interface AvailableAppInfo {
	file: string
	args: (appId: string) => string[]
	/** Some kind of value, how much it costs to run it, per minute */
	cost: number
}

async function tryAfewTimes(cb: () => Promise<boolean>, maxTries: number) {
	for (let i = 0; i < maxTries; i++) {
		if (await cb()) {
			break
		}
	}
}
