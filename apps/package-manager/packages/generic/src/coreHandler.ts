import {
	CoreConnection,
	CoreOptions,
	PeripheralDeviceAPI as P,
	DDPConnectorOptions,
	CollectionObj,
	Observer,
	Collection,
} from '@sofie-automation/server-core-integration'

import { DeviceConfig } from './connector'

import {
	LoggerInstance,
	PackageManagerConfig,
	ProcessHandler,
	StatusCode,
	Statuses,
	stringifyError,
	hashObj,
	setLogLevel,
	getLogLevel,
} from '@shared/api'
import { PACKAGE_MANAGER_DEVICE_CONFIG } from './configManifest'
import { PackageManagerHandler } from './packageManager'

export interface CoreConfig {
	host: string
	port: number
	watchdog: boolean
}
export interface PeripheralDeviceCommand {
	_id: string

	deviceId: string
	functionName: string
	args: Array<any>

	hasReply: boolean
	reply?: any
	replyError?: any

	time: number // time
}

/**
 * Represents a connection between the Gateway and Core
 */
export class CoreHandler {
	private logger: LoggerInstance
	public _observers: Array<any> = []
	public deviceSettings: { [key: string]: any } = {}

	public delayRemoval = 0
	public delayRemovalPackageInfo = 0
	public useTemporaryFilePath = false
	public notUsingCore = false

	private core!: CoreConnection

	private _deviceOptions: DeviceConfig
	private _onConnected?: () => any
	private _executedFunctions: { [id: string]: boolean } = {}
	private _packageManagerHandler?: PackageManagerHandler
	private _coreConfig?: CoreConfig
	private processHandler?: ProcessHandler

	private _statusInitialized = false
	private _statusDestroyed = false
	private statuses: Statuses = {}
	private reportedStatusHash = ''

	constructor(logger: LoggerInstance, deviceOptions: DeviceConfig) {
		this.logger = logger.category('CoreHandler')
		this._deviceOptions = deviceOptions
	}

	async init(config: PackageManagerConfig, processHandler: ProcessHandler): Promise<void> {
		// this.logger.info('========')
		this._statusInitialized = false
		this._coreConfig = {
			host: config.packageManager.coreHost,
			port: config.packageManager.corePort,
			watchdog: config.packageManager.disableWatchdog,
		}

		this.processHandler = processHandler

		this.core = new CoreConnection(this.getCoreConnectionOptions('Package manager', 'PackageManager'))

		this.core.onConnected(() => {
			this.logger.info('Core Connected!')
			this.setupObserversAndSubscriptions().catch((e) => {
				this.logger.error('Core Error during setupObserversAndSubscriptions:', e)
			})
			if (this._onConnected) this._onConnected()
		})
		this.core.onDisconnected(() => {
			this.logger.warn('Core Disconnected!')
		})
		this.core.onError((err) => {
			this.logger.error('Core Error: ' + (err.message || err.toString() || err))
		})

		const ddpConfig: DDPConnectorOptions = {
			host: this._coreConfig.host,
			port: this._coreConfig.port,
		}
		if (this.processHandler && this.processHandler.certificates.length) {
			ddpConfig.tlsOpts = {
				ca: this.processHandler.certificates,
			}
		}

		await this.core.init(ddpConfig)
		this.logger.info(`Core id:: ${this.core.deviceId}`)
		await this.setupObserversAndSubscriptions()
		this._statusInitialized = true
		await this.updateCoreStatus()

		const peripheralDevice = await this.core.getPeripheralDevice()
		this.logger.info(`Device studioId: "${peripheralDevice.studioId}"`)
		if (!peripheralDevice.studioId) {
			this.logger.warn('------------------------------------------------------')
			this.logger.warn('Not setup yet, exiting process!')
			this.logger.warn('To setup, go into Core and add this device to a Studio')
			this.logger.warn('------------------------------------------------------')
			process.exit(1) // eslint-disable-line no-process-exit
			return
		}
	}
	setNoCore() {
		// This is used when PackageManager is used as a standalone app
		this.notUsingCore = true
	}
	setPackageManagerHandler(handler: PackageManagerHandler): void {
		this._packageManagerHandler = handler
	}
	async setupObserversAndSubscriptions(): Promise<void> {
		this.logger.info('Core: Setting up subscriptions..')
		this.logger.info('DeviceId: ' + this.core.deviceId)
		await Promise.all([
			this.core.autoSubscribe('peripheralDevices', {
				_id: this.core.deviceId,
			}),
			this.core.autoSubscribe('studioOfDevice', this.core.deviceId),
			this.core.autoSubscribe('expectedPackagesForDevice', this.core.deviceId, undefined),
			// this.core.autoSubscribe('timelineForDevice', this.core.deviceId),
			this.core.autoSubscribe('peripheralDeviceCommands', this.core.deviceId),
		])

		this.logger.info('Core: Subscriptions are set up!')
		if (this._observers.length) {
			this.logger.info('CoreMos: Clearing observers..')
			this._observers.forEach((obs) => {
				obs.stop()
			})
			this._observers = []
		}
		// setup observers
		const observer = this.core.observe('peripheralDevices')
		observer.added = (id: string) => this.onDeviceChanged(id)
		observer.changed = (id: string) => this.onDeviceChanged(id)
		this.setupObserverForPeripheralDeviceCommands()

		const peripheralDevices = this.core.getCollection('peripheralDevices')
		if (peripheralDevices) {
			peripheralDevices.find({}).forEach((device) => {
				this.onDeviceChanged(device._id)
			})
		}

		return
	}
	async destroy(): Promise<void> {
		this._statusDestroyed = true
		await this.updateCoreStatus()
		await this.core.destroy()
	}
	getCoreConnectionOptions(name: string, subDeviceId: string): CoreOptions {
		let credentials: {
			deviceId: string
			deviceToken: string
		}

		if (this._deviceOptions.deviceId && this._deviceOptions.deviceToken) {
			credentials = {
				deviceId: this._deviceOptions.deviceId + subDeviceId,
				deviceToken: this._deviceOptions.deviceToken,
			}
		} else if (this._deviceOptions.deviceId) {
			this.logger.warn('Token not set, only id! This might be unsecure!')
			credentials = {
				deviceId: this._deviceOptions.deviceId + subDeviceId,
				deviceToken: 'unsecureToken',
			}
		} else {
			credentials = CoreConnection.getCredentials(subDeviceId)
		}
		const options: CoreOptions = {
			...credentials,

			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			deviceCategory: 'package_manager', //P.DeviceCategory.PACKAGE_MANAGER,
			deviceType: 'package_manager', // P.DeviceType.PACKAGE_MANAGER,
			deviceSubType: P.SUBTYPE_PROCESS,

			deviceName: name,
			watchDog: this._coreConfig ? this._coreConfig.watchdog : true,

			configManifest: PACKAGE_MANAGER_DEVICE_CONFIG,

			versions: this._getVersions(),
		}
		return options
	}
	onConnected(fcn: () => any): void {
		this._onConnected = fcn
	}
	onDeviceChanged(id: string): void {
		if (id === this.core.deviceId) {
			const col = this.core.getCollection('peripheralDevices')
			if (!col) throw new Error('collection "peripheralDevices" not found!')

			const device = col.findOne(id)
			if (device) {
				this.deviceSettings = device.settings || {}
			} else {
				this.deviceSettings = {}
			}

			const logLevel = this.deviceSettings['logLevel'] ?? 'info'
			if (logLevel !== getLogLevel()) {
				setLogLevel(logLevel)

				this.logger.info('Loglevel: ' + getLogLevel())

				// this.logger.debug('Test debug logging')
				// this.logger.verbose('Test verbose')
				// this.logger.info('Test info')
				// this.logger.warn('Test warn')
				// this.logger.error('Test error')
				// this.logger.debug({ msg: 'test msg' })
				// this.logger.debug({ message: 'test message' })
				// this.logger.debug({ command: 'test command', context: 'test context' })
				// this.logger.error('Testing error', new Error('This is the error'))

				// this.logger.debug('End test debug logging')
			}

			if (this.deviceSettings['delayRemoval'] !== this.delayRemoval) {
				this.delayRemoval = this.deviceSettings['delayRemoval']
			}
			if (this.deviceSettings['delayRemovalPackageInfo'] !== this.delayRemovalPackageInfo) {
				this.delayRemovalPackageInfo = this.deviceSettings['delayRemovalPackageInfo']
			}
			if (this.deviceSettings['useTemporaryFilePath'] !== this.useTemporaryFilePath) {
				this.useTemporaryFilePath = this.deviceSettings['useTemporaryFilePath']
			}

			if (this._packageManagerHandler) {
				this._packageManagerHandler.onSettingsChanged()
			}
		}
	}

	executeFunction(cmd: PeripheralDeviceCommand): void {
		if (cmd) {
			if (this._executedFunctions[cmd._id]) return // prevent it from running multiple times

			// Ignore specific commands, to reduce noise:
			if (cmd.functionName !== 'getExpetationManagerStatus') {
				this.logger.debug(`Executing function "${cmd.functionName}", args: ${JSON.stringify(cmd.args)}`)
			}

			this._executedFunctions[cmd._id] = true
			const cb = (err: any, res?: any) => {
				if (err) {
					this.logger.error(`executeFunction error: ${stringifyError(err)}`)
				}
				this.core
					.callMethod(P.methods.functionReply, [cmd._id, err, res])
					.then(() => {
						// nothing
					})
					.catch((e) => {
						this.logger.error(`Error when calling method functionReply: ${stringifyError(e)}`)
					})
			}
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			// eslint-disable-next-line @typescript-eslint/ban-types
			const fcn: Function = this[cmd.functionName]
			try {
				if (!fcn) throw Error('Function "' + cmd.functionName + '" not found!')

				Promise.resolve(fcn.apply(this, cmd.args))
					.then((result) => {
						cb(null, result)
					})
					.catch((e) => {
						cb(`${stringifyError(e)}`, null)
					})
			} catch (e) {
				cb(`${stringifyError(e)}`, null)
			}
		}
	}
	retireExecuteFunction(cmdId: string): void {
		delete this._executedFunctions[cmdId]
	}
	observe(collectionName: string): Observer {
		if (!this.core && this.notUsingCore) throw new Error('core.observe called, even though notUsingCore is true.')
		if (!this.core) throw new Error('Core not initialized!')
		return this.core.observe(collectionName)
	}
	getCollection(collectionName: string): Collection {
		if (!this.core && this.notUsingCore) throw new Error('core.observe called, even though notUsingCore is true.')
		if (!this.core) throw new Error('Core not initialized!')
		return this.core.getCollection(collectionName)
	}
	callMethod(methodName: string, attrs?: any[]): Promise<any> {
		if (!this.core && this.notUsingCore) throw new Error('core.observe called, even though notUsingCore is true.')
		if (!this.core) throw new Error('Core not initialized!')
		return this.core.callMethod(methodName, attrs)
	}
	get coreConnected(): boolean {
		return this.core?.connected || false
	}
	setupObserverForPeripheralDeviceCommands(): void {
		const observer = this.core.observe('peripheralDeviceCommands')
		this.killProcess(0)
		this._observers.push(observer)

		const addedChangedCommand = (id: string) => {
			const cmds = this.core.getCollection('peripheralDeviceCommands')
			if (!cmds) throw Error('"peripheralDeviceCommands" collection not found!')

			const cmd = cmds.findOne(id) as PeripheralDeviceCommand
			if (!cmd) throw Error('PeripheralCommand "' + id + '" not found!')

			if (cmd.deviceId === this.core.deviceId) {
				this.executeFunction(cmd)
			}
		}
		observer.added = (id: string) => {
			addedChangedCommand(id)
		}
		observer.changed = (id: string) => {
			addedChangedCommand(id)
		}
		observer.removed = (id: string) => {
			this.retireExecuteFunction(id)
		}
		const cmds = this.core.getCollection('peripheralDeviceCommands')
		if (!cmds) throw Error('"peripheralDeviceCommands" collection not found!')

		cmds.find({}).forEach((cmd0: CollectionObj) => {
			const cmd = cmd0 as PeripheralDeviceCommand
			if (cmd.deviceId === this.core.deviceId) {
				this.executeFunction(cmd)
			}
		})
	}
	killProcess(actually: number): boolean {
		if (actually === 1) {
			this.logger.info('KillProcess command received, shutting down in 1000ms!')
			setTimeout(() => {
				// eslint-disable-next-line no-process-exit
				process.exit(0)
			}, 1000)
			return true
		}
		return false
	}
	pingResponse(message: string): void {
		this.core.setPingResponse(message)
	}
	getSnapshot(): any {
		this.logger.info('getSnapshot')
		return {} // TODO: implement?
	}
	getDevicesInfo(): any {
		this.logger.info('getDevicesInfo')

		return []
	}
	async setStatus(statuses: Statuses): Promise<any> {
		this.statuses = statuses
		await this.updateCoreStatus()
	}
	private async updateCoreStatus(): Promise<any> {
		let statusCode = P.StatusCode.GOOD
		const messages: Array<string> = []

		if (!this._statusInitialized) {
			statusCode = P.StatusCode.BAD
			messages.push('Starting up...')
		}
		if (this._statusDestroyed) {
			statusCode = P.StatusCode.BAD
			messages.push('Shut down')
		}

		if (statusCode === P.StatusCode.GOOD) {
			for (const status of Object.values(this.statuses)) {
				if (status && status.statusCode !== StatusCode.GOOD) {
					statusCode = Math.max(statusCode, status.statusCode)
					messages.push(status.message)
				}
			}
		}

		const statusHash = hashObj({ statusCode, messages })
		if (this.reportedStatusHash !== statusHash) {
			this.reportedStatusHash = statusHash

			await this.core.setStatus({
				statusCode: statusCode,
				messages: messages,
			})
		}
	}
	private _getVersions() {
		const versions: { [packageName: string]: string } = {}

		if (process.env.npm_package_version) {
			versions['_process'] = process.env.npm_package_version
		}
		return versions
	}

	restartExpectation(workId: string): void {
		return this._packageManagerHandler?.restartExpectation(workId)
	}
	restartAllExpectations(): void {
		return this._packageManagerHandler?.restartAllExpectations()
	}
	abortExpectation(workId: string): void {
		return this._packageManagerHandler?.abortExpectation(workId)
	}
	restartPackageContainer(containerId: string): void {
		return this._packageManagerHandler?.restartPackageContainer(containerId)
	}
	troubleshoot(): any {
		return this._packageManagerHandler?.getDataSnapshot()
	}
	async getExpetationManagerStatus(): Promise<any> {
		return this._packageManagerHandler?.getExpetationManagerStatus()
	}
	async debugKillApp(appId: string): Promise<void> {
		return this._packageManagerHandler?.debugKillApp(appId)
	}
}
