import { IWorkInProgress } from '../../lib/workInProgress'
import {
	Expectation,
	ExpectationManagerWorkerAgent,
	LoggerInstance,
	PackageContainerExpectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	ReturnTypeRunPackageContainerCronJob,
	WorkerAgentConfig,
} from '@shared/api'

import { GenericWorker, WorkerLocation } from '../../worker'
import { SetupPackageContainerMonitorsResult } from '../../accessorHandlers/genericHandle'

/** This is a type of worker that runs on a linux machine */
export class LinuxWorker extends GenericWorker {
	static readonly type = 'linuxWorker'
	constructor(
		logger: LoggerInstance,
		public readonly config: WorkerAgentConfig,
		sendMessageToManager: ExpectationManagerWorkerAgent.MessageFromWorker,
		location: WorkerLocation
	) {
		super(logger.category('LinuxWorker'), config, location, sendMessageToManager, LinuxWorker.type)
	}
	async doYouSupportExpectation(_exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		return {
			support: false,
			reason: { user: `Not implemented yet`, tech: `Not implemented yet` },
		}
	}
	async init(): Promise<void> {
		throw new Error(`Not implemented yet`)
	}
	terminate(): void {
		throw new Error(`Not implemented yet`)
	}
	getCostFortExpectation(_exp: Expectation.Any): Promise<ReturnTypeGetCostFortExpectation> {
		throw new Error(`Not implemented yet`)
	}
	isExpectationReadyToStartWorkingOn(_exp: Expectation.Any): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		throw new Error(`Not implemented yet`)
	}
	isExpectationFullfilled(
		_exp: Expectation.Any,
		_wasFullfilled: boolean
	): Promise<ReturnTypeIsExpectationFullfilled> {
		throw new Error(`Not implemented yet`)
	}
	workOnExpectation(_exp: Expectation.Any): Promise<IWorkInProgress> {
		throw new Error(`Not implemented yet`)
	}
	removeExpectation(_exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation> {
		throw new Error(`Not implemented yet`)
	}

	async doYouSupportPackageContainer(
		_packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportPackageContainer> {
		return {
			support: false,
			reason: { user: `Not implemented yet`, tech: `Not implemented yet` },
		}
	}
	async runPackageContainerCronJob(
		_packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeRunPackageContainerCronJob> {
		throw new Error(`Not implemented yet`)
	}
	async setupPackageContainerMonitors(
		_packageContainer: PackageContainerExpectation
	): Promise<SetupPackageContainerMonitorsResult> {
		throw new Error(`Not implemented yet`)
	}
}
