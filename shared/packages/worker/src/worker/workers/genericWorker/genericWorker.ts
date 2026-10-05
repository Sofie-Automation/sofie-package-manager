import fs from 'node:fs'
import path from 'node:path'

import {
	assertNever,
	Expectation,
	ExpectationManagerWorkerAgent,
	LoggerInstance,
	PackageContainerExpectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	ReturnTypeRunPackageContainerCronJob,
	stringifyError,
} from '@sofie-package-manager/api'

import { SetupPackageContainerMonitorsResult } from '../../accessorHandlers/genericHandle.js'
import { ExpectationHandler } from '../../lib/expectationHandler.js'
import { IWorkInProgress } from '../../lib/workInProgress.js'
import { BaseWorker, GenericWorkerAgentAPI } from '../../worker.js'
import { FileCopy } from './expectationHandlers/fileCopy.js'
import { FileCopyProxy } from './expectationHandlers/fileCopyProxy.js'
import { FileVerify } from './expectationHandlers/fileVerify.js'
import { JsonDataCopy } from './expectationHandlers/jsonDataCopy.js'
import { KairosLoadToRam } from './expectationHandlers/kairosLoadToRam.js'
import { MediaFileConvert } from './expectationHandlers/mediaFileConvert.js'
import { MediaFilePreview } from './expectationHandlers/mediaFilePreview.js'
import { MediaFileThumbnail } from './expectationHandlers/mediaFileThumbnail.js'
import { PackageDeepScan } from './expectationHandlers/packageDeepScan.js'
import { PackageIframesScan } from './expectationHandlers/packageIframesScan.js'
import { PackageLoudnessScan } from './expectationHandlers/packageLoudnessScan.js'
import { PackageScan } from './expectationHandlers/packageScan.js'
import { QuantelClipCopy } from './expectationHandlers/quantelClipCopy.js'
import { QuantelClipPreview } from './expectationHandlers/quantelClipPreview.js'
import { QuantelThumbnail } from './expectationHandlers/quantelClipThumbnail.js'
import { RenderHTML } from './expectationHandlers/renderHTML.js'
import { ExecutableDependencyHandler } from './lib/executableDependencyHandler.js'
import * as PackageContainerExpHandler from './packageContainerExpectationHandler.js'

export type ExpectationHandlerGenericWorker = ExpectationHandler<GenericWorker>

/** This is a type of worker that runs on a windows machine */
export class GenericWorker extends BaseWorker {
	static readonly type = 'genericWorker'

	public executables: ExecutableDependencyHandler

	private monitorExecutables: NodeJS.Timeout | undefined

	constructor(
		logger: LoggerInstance,
		agentAPI: GenericWorkerAgentAPI,
		sendMessageToManager: ExpectationManagerWorkerAgent.MessageFromWorker
	) {
		super(logger.category('GenericWorker'), agentAPI, sendMessageToManager, GenericWorker.type)

		this.executables = new ExecutableDependencyHandler(logger.category('ExecutableDependencyHandler'), this)

		this.logger.debug(`Worker started`)
	}
	async doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		return this.getExpectationHandler(exp).doYouSupportExpectation(exp, this)
	}
	async init(): Promise<void> {
		await this.executables.checkExecutables()
		this.monitorExecutables = setInterval(
			() => {
				this.executables.checkExecutables().catch((err) => {
					this.logger.error(`Error in checkExecutables: ${stringifyError(err)}`)
				})
			},
			1000 * 60 * 5
		) // Check every 5 minutes
		this.logger.debug(`Worker initialized`)
	}
	terminate(): void {
		if (this.monitorExecutables) {
			clearInterval(this.monitorExecutables)
			delete this.monitorExecutables
		}
		this.logger.debug(`Worker terminated`)
	}

	async getCostFortExpectation(exp: Expectation.Any): Promise<ReturnTypeGetCostFortExpectation> {
		return this.getExpectationHandler(exp).getCostForExpectation(exp, this)
	}
	async isExpectationReadyToStartWorkingOn(
		exp: Expectation.Any
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		return this.getExpectationHandler(exp).isExpectationReadyToStartWorkingOn(exp, this)
	}
	async isExpectationFulfilled(
		exp: Expectation.Any,
		wasFulfilled: boolean
	): Promise<ReturnTypeIsExpectationFulfilled> {
		return this.getExpectationHandler(exp).isExpectationFulfilled(exp, wasFulfilled, this)
	}
	async workOnExpectation(exp: Expectation.Any, progressTimeout: number): Promise<IWorkInProgress> {
		return this.getExpectationHandler(exp).workOnExpectation(exp, this, progressTimeout)
	}
	async removeExpectation(exp: Expectation.Any, reason: string): Promise<ReturnTypeRemoveExpectation> {
		return this.getExpectationHandler(exp).removeExpectation(exp, reason, this)
	}
	private getExpectationHandler(exp: Expectation.Any): ExpectationHandlerGenericWorker {
		switch (exp.type) {
			case Expectation.Type.FILE_COPY:
				return FileCopy
			case Expectation.Type.FILE_COPY_PROXY:
				return FileCopyProxy
			case Expectation.Type.FILE_VERIFY:
				return FileVerify
			case Expectation.Type.PACKAGE_KAIROS_LOAD_TO_RAM:
				return KairosLoadToRam
			case Expectation.Type.PACKAGE_SCAN:
				return PackageScan
			case Expectation.Type.PACKAGE_DEEP_SCAN:
				return PackageDeepScan
			case Expectation.Type.PACKAGE_LOUDNESS_SCAN:
				return PackageLoudnessScan
			case Expectation.Type.PACKAGE_IFRAMES_SCAN:
				return PackageIframesScan
			case Expectation.Type.MEDIA_FILE_THUMBNAIL:
				return MediaFileThumbnail
			case Expectation.Type.MEDIA_FILE_PREVIEW:
				return MediaFilePreview
			case Expectation.Type.MEDIA_FILE_CONVERT:
				return MediaFileConvert
			case Expectation.Type.QUANTEL_CLIP_COPY:
				return QuantelClipCopy
			case Expectation.Type.QUANTEL_CLIP_THUMBNAIL:
				return QuantelThumbnail
			case Expectation.Type.QUANTEL_CLIP_PREVIEW:
				return QuantelClipPreview
			case Expectation.Type.JSON_DATA_COPY:
				return JsonDataCopy
			case Expectation.Type.RENDER_HTML:
				return RenderHTML
			default:
				assertNever(exp)
				// @ts-expect-error exp.type is never
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}

	async doYouSupportPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportPackageContainer> {
		return PackageContainerExpHandler.doYouSupportPackageContainer(packageContainer, this)
	}
	async runPackageContainerCronJob(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeRunPackageContainerCronJob> {
		return PackageContainerExpHandler.runPackageContainerCronJob(packageContainer, this)
	}
	async setupPackageContainerMonitors(
		packageContainer: PackageContainerExpectation
	): Promise<SetupPackageContainerMonitorsResult> {
		return PackageContainerExpHandler.setupPackageContainerMonitors(packageContainer, this)
	}

	private hasEnsuredTemporaryFolderPath = new Set<string>()
	getTemporaryFolderPath(localPath = ''): string {
		const tempBasePath =
			this.agentAPI.config.temporaryFolderPath ||
			(process.platform === 'win32' ? 'C:\\temp\\package-manager' : '/tmp/package-manager')

		const tempPath = path.join(tempBasePath, localPath)
		if (!this.hasEnsuredTemporaryFolderPath.has(tempPath)) {
			this.hasEnsuredTemporaryFolderPath.add(tempPath)
			fs.mkdirSync(tempPath, { recursive: true })
		}
		return tempPath
	}
}
