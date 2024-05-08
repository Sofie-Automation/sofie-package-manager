import {
	WorkForceAppContainer,
	AdapterServer,
	AdapterServerOptions,
	LogLevel,
	Expectation,
	PackageContainerExpectation,
	Reason,
	WorkforceId,
	AppType,
	AppId,
	Cost,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a AppContainer, to be called from the Workforce
 * Note: The AppContainer connects to the Workforce, therefore the Workforce is the AdapterServer here.
 * The corresponding other side is implemented at shared/packages/worker/src/workforceApi.ts
 */
export class AppContainerAPI
	extends AdapterServer<WorkForceAppContainer.WorkForce, WorkForceAppContainer.AppContainer>
	implements WorkForceAppContainer.AppContainer
{
	constructor(
		public id: WorkforceId,
		methods: WorkForceAppContainer.WorkForce,
		options: AdapterServerOptions<WorkForceAppContainer.AppContainer>
	) {
		super(methods, options)
	}

	async setLogLevel(logLevel: LogLevel): Promise<void> {
		return this._sendMessage('setLogLevel', logLevel)
	}
	async _debugKill(): Promise<void> {
		return this._sendMessage('_debugKill')
	}
	async _debugSendKillConnections(): Promise<void> {
		return this._sendMessage('_debugSendKillConnections')
	}

	async requestAppTypeForExpectation(
		exp: Expectation.Any
	): Promise<{ success: true; appType: AppType; cost: Cost } | { success: false; reason: Reason }> {
		return this._sendMessage('requestAppTypeForExpectation', exp)
	}
	async requestAppTypeForPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<{ success: true; appType: AppType; cost: Cost } | { success: false; reason: Reason }> {
		return this._sendMessage('requestAppTypeForPackageContainer', packageContainer)
	}
	async spinUp(appType: AppType): Promise<AppId> {
		return this._sendMessage('spinUp', appType)
	}
	async spinDown(appId: AppId, reason: string): Promise<void> {
		return this._sendMessage('spinDown', appId, reason)
	}
	async getRunningApps(): Promise<{ appId: AppId; appType: AppType }[]> {
		return this._sendMessage('getRunningApps')
	}
}
