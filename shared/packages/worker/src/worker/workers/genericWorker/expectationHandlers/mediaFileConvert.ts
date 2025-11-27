import { BaseWorker } from '../../../worker'
import { getStandardCost, makeUniversalVersion, UniversalVersion } from '../lib/lib'
import {
	Accessor,
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	stringifyError,
	PackageContainerId,
	protectString,
	AccessorId,
	PackageContainerOnPackage,
	AccessorOnPackage,
	escapeFilePath,
	PackageContainerExpectation,
	LoggerInstance,
} from '@sofie-package-manager/api'
import {
	isFileShareAccessorHandle,
	isFTPAccessorHandle,
	isHTTPAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { ExpectationHandlerGenericWorker, GenericWorker } from '../genericWorker'
import { GenericAccessorHandle } from '../../../accessorHandlers/genericHandle'
import { doFileCopyExpectation, isFileFulfilled } from './lib/file'
import { ProgressPart, ProgressParts } from './progressParts'

import path from 'path'
import { SpawnedProcess, spawnProcess } from './lib/spawnProcess'

/**
 * Generates a low-res preview video of a source video file, and stores the resulting file into the target PackageContainer
 */
export const MediaFileConvert: ExpectationHandlerGenericWorker = {
	async doYouSupportExpectation(
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeDoYouSupportExpectation> {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		for (const conversion of exp.endRequirement.version.conversions) {
			const status = await worker.executables.getExecutableStatus(conversion.executable)
			if (status !== null) {
				return {
					support: false,
					knownReason: true,
					reason: {
						user: `There is an issue with the Worker ("${conversion.executable}" not found)`,
						tech: `Cannot access "${conversion.executable}" on the worker. Reason: ${status}`,
					},
				}
			}
		}

		return checkWorkerHasAccessToPackageContainersOnPackage(worker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupConvertSources(worker, exp)
		if (!lookupSource.ready)
			return {
				ready: lookupSource.ready,
				knownReason: lookupSource.knownReason,
				sourceExists: false,
				reason: lookupSource.reason,
			}
		const lookupTarget = await lookupConvertTargets(worker, exp)
		if (!lookupTarget.ready)
			return { ready: lookupTarget.ready, knownReason: lookupTarget.knownReason, reason: lookupTarget.reason }

		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success)
			return {
				ready: false,
				knownReason: tryReading.knownReason,
				sourceExists: tryReading.packageExists,
				reason: tryReading.reason,
			}

		return {
			ready: true,
		}
	},
	isExpectationFulfilled: async (
		exp: Expectation.Any,
		_wasFulfilled: boolean,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupConvertSources(worker, exp)
		const lookupTarget = await lookupConvertTargets(worker, exp)

		const fulfilled = await isFileFulfilled(worker, lookupSource, lookupTarget, (sourceUVersion) => {
			// Extend the source version with the conversion parameters:
			extendUVersion(sourceUVersion, exp)
			return sourceUVersion
		})
		// Ensure that the target Package is staying Fulfilled:
		if (fulfilled.fulfilled && lookupTarget.ready) await lookupTarget.handle.ensurePackageFulfilled()
		return fulfilled
	},
	workOnExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<IWorkInProgress> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		// const timer = startTimer()

		const lookupSource = await lookupConvertSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupConvertTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle

		if (
			(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP_PROXY ||
				lookupSource.accessor.type === Accessor.AccessType.FTP) &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY ||
				lookupTarget.accessor.type === Accessor.AccessType.FTP)
		) {
			// We can read the source and write the preview directly.
			if (
				!isLocalFolderAccessorHandle(sourceHandle) &&
				!isFileShareAccessorHandle(sourceHandle) &&
				!isHTTPAccessorHandle(sourceHandle) &&
				!isHTTPProxyAccessorHandle(sourceHandle) &&
				!isFTPAccessorHandle(sourceHandle)
			)
				throw new Error(`Source AccessHandler type is wrong`)
			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPProxyAccessorHandle(targetHandle) &&
				!isFTPAccessorHandle(targetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

			let mediaConversion: MediaConversion | null = null

			const workInProgress = new WorkInProgress({ workLabel: 'Converting media file...' }, async () => {
				// On cancel
				mediaConversion
					?.cancel()
					.catch((err) => worker.logger.error(`Error cancelling mediaConversion: ${stringifyError(err)}`))
			}).do(async () => {
				const progressTracker = new ProgressParts()
				progressTracker.on('progress', (p) => {
					workInProgress._reportProgress(actualSourceVersionHash, p)
				})
				const progressSetup = progressTracker.addPart(1)
				const progressFinalize = progressTracker.addPart(1)

				const tryReadPackage = await sourceHandle.checkPackageReadAccess()
				if (!tryReadPackage.success) throw new Error(tryReadPackage.reason.tech)

				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)
				extendUVersion(actualSourceUVersion, exp)
				const actualSourceVersionHash = hashObj(actualSourceUVersion)

				await targetHandle.removePackage('Prepare for media file generation')

				const fileOperation = await targetHandle.prepareForOperation('Convert Media file', lookupSource.handle)

				progressSetup(1)

				if (!isLookupFilePackageContainer(lookupSource))
					throw new Error(`Source is not a file-based PackageContainer`)
				if (!isLookupFilePackageContainer(lookupTarget))
					throw new Error(`Target is not a file-based PackageContainer`)

				mediaConversion = new MediaConversion(
					worker,
					progressTracker,
					exp,
					lookupSource,
					lookupTarget,
					workInProgress
				)
				await mediaConversion.work()
				mediaConversion = null

				// Overwrite target metadata:
				await targetHandle.updateMetadata(actualSourceUVersion)
				await targetHandle.finalizePackage(fileOperation)

				progressFinalize(1)
			})

			return workInProgress
		} else {
			throw new Error(
				`MediaFileConvert.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupConvertTargets(worker, exp)
		if (!lookupTarget.ready) {
			return {
				removed: false,
				knownReason: lookupTarget.knownReason,
				reason: {
					user: `Can't access target, due to: ${lookupTarget.reason.user}`,
					tech: `No access to target: ${lookupTarget.reason.tech}`,
				},
			}
		}

		try {
			await lookupTarget.handle.removePackage(reason)
		} catch (err) {
			return {
				removed: false,
				knownReason: false,
				reason: {
					user: `Cannot remove file due to an internal error`,
					tech: `Cannot remove preview file: ${stringifyError(err)}`,
				},
			}
		}

		return {
			removed: true,
			// reason: { user: ``, tech: `Removed preview file "${exp.endRequirement.content.filePath}" from target` },
		}
	},
}
function isMediaFileConvert(exp: Expectation.Any): exp is Expectation.MediaFileConvert {
	return exp.type === Expectation.Type.MEDIA_FILE_CONVERT
}

function extendUVersion(sourceUVersion: UniversalVersion, exp: Expectation.MediaFileConvert) {
	// Extend the source version with the conversion parameters:
	sourceUVersion['conversions'] = {
		name: 'Conversions',
		value: JSON.stringify(exp.endRequirement.version.conversions),
	}
}

async function lookupConvertSources(
	worker: BaseWorker,
	exp: Expectation.MediaFileConvert
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.startRequirement.sources,
		exp.endRequirement.targets,
		{ expectationId: exp.id },
		exp.endRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
			packageVersion: exp.endRequirement.version,
		}
	)
}
async function lookupConvertTargets(
	worker: BaseWorker,
	exp: Expectation.MediaFileConvert
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.endRequirement.targets,
		exp.startRequirement.sources,
		{ expectationId: exp.id },
		exp.endRequirement.content,
		exp.workOptions,
		{
			write: true,
			writePackageContainer: true,
		}
	)
}

export type LookupFilePackageContainer<Metadata> = {
	ready: true
	accessor:
		| AccessorOnPackage.LocalFolder
		| AccessorOnPackage.FileShare
		| AccessorOnPackage.HTTP
		| AccessorOnPackage.HTTPProxy
		| AccessorOnPackage.Quantel

	handle: GenericAccessorHandle<Metadata>
}
function isLookupFilePackageContainer<T>(lookup: LookupPackageContainer<T>): lookup is LookupFilePackageContainer<T> {
	return (
		lookup.ready &&
		(isLocalFolderAccessorHandle(lookup.handle) ||
			isFileShareAccessorHandle(lookup.handle) ||
			isHTTPAccessorHandle(lookup.handle) ||
			isHTTPProxyAccessorHandle(lookup.handle) ||
			isFTPAccessorHandle(lookup.handle))
	)
}

/**
 * A fleeting instance to handle media conversions.
 * This class is instantiated, then work() is called, then the instance is discarded.
 */
class MediaConversion {
	/**
	 * Pointer to the current source of the operation
	 */

	private localPackageContainerIndex = -1
	public readonly workId: string

	/** Currently running operation, if any. Used for cancelling. */
	private currentOperation: MediaConversionOperation | null = null

	private logger: LoggerInstance
	constructor(
		public worker: BaseWorker,
		public progressTracker: ProgressParts,
		public exp: Expectation.MediaFileConvert,
		public lookupSource: LookupFilePackageContainer<UniversalVersion>,
		public lookupTarget: LookupFilePackageContainer<UniversalVersion>,
		public workInProgress: WorkInProgress
	) {
		this.logger = worker.logger.category('MediaConversion')
		this.workId = Math.random().toString(36).substring(2, 7)
	}

	public async cancel(): Promise<void> {
		if (this.currentOperation) {
			await this.currentOperation.cancel()
		}
	}

	public async work() {
		const conversions = this.exp.endRequirement.version.conversions

		if (conversions.length === 0) throw new Error(`No conversion operations defined`)

		// Prepare the operations:
		const operations: MediaConversionOperation[] = []
		let prevOperation: MediaConversionOperation | null = null

		for (let i = 0; i < this.exp.endRequirement.version.conversions.length; i++) {
			const conversion = this.exp.endRequirement.version.conversions[i]
			const isFinalStep = i === this.exp.endRequirement.version.conversions.length - 1

			const operation: MediaConversionOperation = new MediaConversionOperation(
				this.logger.category(`Step ${i + 1}`),
				this,
				prevOperation,
				this.exp,
				conversion,
				isFinalStep
			)
			operations.push(operation)
			prevOperation = operation
		}

		let operationPointer: OperationPointer = {
			lookup: this.lookupSource,
			packageContainer: {
				accessors: { [this.lookupSource.handle.accessorId]: this.lookupSource.accessor },
				containerId: protectString('N/A'),
				label: 'Source',
			},
			isTemporary: false,
		}

		// Execute the operations:
		for (const operation of operations) {
			this.currentOperation = operation
			const nextOperationPointer = await operation.work(operationPointer)
			this.currentOperation = null

			operationPointer = nextOperationPointer
		}
	}

	public getLocalPackageContainer(): {
		packageContainer: Expectation.SpecificPackageContainerOnPackage.FileSource
		exp: PackageContainerExpectation
	} {
		this.localPackageContainerIndex++
		const localPath = `source${this.localPackageContainerIndex}`
		const accessorId = protectString<AccessorId>('local')
		const accessor: Accessor.LocalFolder = {
			type: Accessor.AccessType.LOCAL_FOLDER,
			label: 'Local temporary folder',
			folderPath: this.worker.getTemporaryFolderPath(localPath),
			allowRead: true,
			allowWrite: true,
		}
		const packageContainer: Expectation.SpecificPackageContainerOnPackage.FileSource = {
			label: `Local temp ${localPath}`,
			containerId: protectString<PackageContainerId>(`__local-temp-${localPath}`),
			accessors: { [accessorId]: accessor },
		}

		const exp: PackageContainerExpectation = {
			...packageContainer,
			id: packageContainer.containerId,
			cronjobs: {
				// Cleanup files due for removal:
				cleanup: {
					label: 'Cleanup temporary files',
					// Remove untracked files as well:
					cleanFileAge: 30 * 60, // files older than 30 minutes (in seconds)
				},
			},
			managerId: protectString('tmp_convert'),
			monitors: {},
			accessors: { [accessorId]: accessor },
		}
		return { packageContainer, exp }
	}
}
class MediaConversionOperation {
	private reportPrepareLocal: ProgressPart
	private reportFinalizeLocal: ProgressPart
	private reportPrepare: ProgressPart
	private reportProgress: ProgressPart
	private reportFinalize: ProgressPart

	private subWorkInProgress: IWorkInProgress | null = null
	private spawnedProcess: SpawnedProcess | undefined = undefined

	constructor(
		private logger: LoggerInstance,
		private parent: MediaConversion,
		previousOperation: MediaConversionOperation | null,
		private exp: Expectation.MediaFileConvert,
		private conversion: Expectation.Version.ConversionStep,
		private isFinalStep: boolean
	) {
		const isFirst = previousOperation === null

		this.reportPrepareLocal = this.parent.progressTracker.addPart(isFirst && conversion.needsLocalSource ? 3 : 0)
		this.reportFinalizeLocal = this.parent.progressTracker.addPart(
			this.isFinalStep && conversion.needsLocalTarget ? 3 : 0
		)

		this.reportPrepare = this.parent.progressTracker.addPart(1)
		this.reportProgress = this.parent.progressTracker.addPart(10)
		this.reportFinalize = this.parent.progressTracker.addPart(1)
	}
	public async cancel(): Promise<void> {
		if (this.spawnedProcess) this.spawnedProcess.cancel()
		if (this.subWorkInProgress) await this.subWorkInProgress.cancel()
	}

	public async work(operationPointer: OperationPointer): Promise<OperationPointer> {
		this.logger.debug('Starting work')
		// Step 1: (Maybe) copy source file to local temp folder:

		// Change pointer to match the new location:
		operationPointer = await this.copyToLocalTempFolder(operationPointer)
		this.reportPrepareLocal(1)

		// Prepare target pointer:
		const operationTargetPointer = await this.prepareTargetPointer(operationPointer)

		// Step 2: Do the conversion:

		await this.convert(operationPointer, operationTargetPointer)
		this.reportProgress(1)
		// (Maybe) Cleanup the source, since the conversion is now done with it:
		await this.cleanupSource(operationPointer)
		this.reportFinalize(1)

		// Step 3: (Maybe) copy target file from local temp folder:

		// Change pointer to match the new location:
		await this.copyFromTempToTarget(operationTargetPointer)

		if (this.isFinalStep) {
			// (Maybe) Cleanup the source, since the file has been copied to the final target:
			await this.cleanupSource(operationTargetPointer)
		}
		this.reportFinalizeLocal(1)

		this.logger.debug('Done')

		return operationTargetPointer
	}

	/**
	 * Copy source file to local temp folder
	 */
	private async copyToLocalTempFolder(operationPointer: OperationPointer): Promise<OperationPointer> {
		if (
			!this.conversion.needsLocalSource ||
			operationPointer.lookup.accessor.type === Accessor.AccessType.LOCAL_FOLDER
		) {
			// No need to do any copying as we can use the current source directly:
			return operationPointer
		}

		// Source is not local, so we need to copy the file to a local folder first:
		const localPackageContainer = this.parent.getLocalPackageContainer()

		const sourcePath = await this.getAccessorFullPath(operationPointer.lookup.handle)

		const localLookup = await this.lookupLocalAccessorHandle(
			[localPackageContainer.packageContainer],
			path.basename(sourcePath),
			operationPointer
		)

		if (!localLookup.ready) throw new Error(`Internal Error: localLookup is not ready: ${localLookup.reason.tech}`)

		if (!isLookupFilePackageContainer(localLookup))
			// type guard:
			throw new Error(
				`Internal Error: localLookup is not a file-based PackageContainer (is ${localLookup.accessor?.type})`
			)
		if (this.isItTimeToRunCronJob(localPackageContainer.packageContainer.containerId)) {
			const runResult = await localLookup.handle.runCronJob(localPackageContainer.exp)
			if (!runResult.success)
				this.logger.warn(
					`Running cronjob for local temp PackageContainer ${localPackageContainer.packageContainer.containerId} failed: ${runResult.reason.tech}`
				)
		}

		await this.copyFile(this.parent.lookupSource, localLookup, 'prepare source', this.reportPrepareLocal)

		// Return pointer to new local source:
		return {
			lookup: localLookup,
			packageContainer: localPackageContainer.packageContainer,
			isTemporary: true,
		}
	}
	/**
	 * Copy from local temp folder to final target
	 */
	private async copyFromTempToTarget(operationPointer: OperationPointer): Promise<void> {
		if (!this.isFinalStep || !operationPointer.isTemporary) {
			// No need to do any copying
			return
		}
		await this.copyFile(
			operationPointer.lookup,
			this.parent.lookupTarget,
			'final copy to target',
			this.reportFinalizeLocal
		)
	}
	/**
	 * Performs a file copy between two file-based PackageContainers
	 * Populates this.subWorkInProgress while running, used for cancellation
	 */
	async copyFile(
		fromPackageContainer: LookupFilePackageContainer<UniversalVersion>,
		toPackageContainer: LookupFilePackageContainer<UniversalVersion>,
		context: string,
		onProgress: ProgressPart
	) {
		const wip = await doFileCopyExpectation(this.exp, fromPackageContainer, toPackageContainer)
		if (!wip) throw new Error(`Unable to do file copy, wip is null (${context})`)
		this.subWorkInProgress = wip
		await new Promise((resolve, reject) => {
			wip.on('progress', (_actualVersionHash, progress) => {
				onProgress(progress)
			})
			wip.on('done', resolve)
			wip.on('error', (e: string) => reject(new Error(e)))
		})
		wip.removeAllListeners()
		this.subWorkInProgress = null
	}
	private async prepareTargetPointer(operationPointer: OperationPointer): Promise<OperationPointer> {
		const lookupTarget = this.parent.lookupTarget

		if (this.isFinalStep && lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
			// Can use the final target directly:
			return {
				lookup: lookupTarget,
				packageContainer: {
					accessors: { [lookupTarget.handle.accessorId]: lookupTarget.accessor },
					containerId: protectString('N/A'),
					label: 'Source',
				},
				isTemporary: false,
			}
		} else {
			// When doing multiple steps, use a temp local folder in between them:

			const localPackageContainer = this.parent.getLocalPackageContainer()

			let fileName: string
			if (!this.isFinalStep && this.conversion.outputFileName !== undefined)
				fileName = this.conversion.outputFileName
			else fileName = path.basename(this.exp.endRequirement.content.filePath)

			const localLookup = await this.lookupLocalAccessorHandle(
				[localPackageContainer.packageContainer],
				fileName,
				operationPointer
			)

			if (!localLookup.ready)
				throw new Error(`Internal Error: localLookup is not ready: ${localLookup.reason.tech}`)

			if (!isLookupFilePackageContainer(localLookup))
				// type guard:
				throw new Error(
					`Internal Error: localLookup for final step is not a file-based PackageContainer (is${localLookup.accessor?.type})`
				)

			if (this.isItTimeToRunCronJob(localPackageContainer.packageContainer.containerId)) {
				const runResult = await localLookup.handle.runCronJob(localPackageContainer.exp)
				if (!runResult.success)
					this.logger.warn(
						`Running cronjob for local temp PackageContainer ${localPackageContainer.packageContainer.containerId} failed: ${runResult.reason.tech}`
					)
			}

			return {
				lookup: localLookup,
				packageContainer: localPackageContainer.packageContainer,
				isTemporary: true,
			}
		}
	}
	private async convert(operationPointer: OperationPointer, operationTargetPointer: OperationPointer) {
		this.reportPrepare(0.5)

		const sourcePath = await this.getAccessorFullPath(operationPointer.lookup.handle)
		const targetPath = await this.getAccessorFullPath(operationTargetPointer.lookup.handle)
		this.reportPrepare(1)

		const argsReplaceStrings: Record<string, string> = {
			SOURCE: escapeFilePath(sourcePath),
			TARGET: escapeFilePath(targetPath),
		}
		const args = this.conversion.args.map((arg) => {
			let argOut = arg
			for (const [key, val] of Object.entries<string>(argsReplaceStrings)) {
				argOut = argOut.replace(`{${key}}`, val)
			}
			return argOut
		})

		this.logger.debug(`Spawning process: ${this.conversion.executable} ${args.join(' ')}`)

		try {
			await new Promise<void>((resolve, reject) => {
				this.spawnedProcess = spawnProcess(
					this.conversion.executable,
					args,
					() => {
						// On Done
						resolve()
					},
					(err) => {
						// On Error
						reject(err)
					},
					(progress: number) => {
						// On Progress
						this.reportProgress(progress)
					}
					// this.logger.silly
				)
			})
		} finally {
			this.spawnedProcess = undefined
		}
	}
	/**
	 * Remove file from temporary source
	 */
	private async cleanupSource(operationPointer: OperationPointer) {
		if (!operationPointer.isTemporary) {
			// Nothing to do, we only remove temporary files
			return
		}
		try {
			await operationPointer.lookup.handle.removePackage('Cleanup temporary file after conversion step')
		} catch (err) {
			this.logger.warn(`Error removing temporary source file: ${stringifyError(err)} (will continue)`)
		}
	}
	private async getAccessorFullPath(handle: GenericAccessorHandle<UniversalVersion>): Promise<string> {
		if (isLocalFolderAccessorHandle(handle)) {
			return handle.fullPath
		} else if (isFileShareAccessorHandle(handle)) {
			await handle.prepareFileAccess()
			return handle.fullPath
		} else if (isHTTPAccessorHandle(handle)) {
			return handle.fullUrl
		} else if (isHTTPProxyAccessorHandle(handle)) {
			return handle.fullUrl
		} else if (isFTPAccessorHandle(handle)) {
			return handle.ftpUrl.url
		} else {
			throw new Error(`Unsupported AccessHandler`)
		}
	}
	/**
	 * Returns true if enough time has passed to run
	 * @param containerId
	 */
	private isItTimeToRunCronJob(containerId: PackageContainerId): boolean {
		const accessorCache = this.parent.worker.accessorCache

		let cache = accessorCache['__mediaFileConvert'] as { [key: string]: number }
		if (!cache) {
			cache = {}
			accessorCache['__mediaFileConvert'] = cache
		}

		// Run once every 10 minutes, and on first call (ie on worker restart)

		const lastRun = cache[`cronjob-${containerId}`] ?? 0

		if (lastRun < Date.now() - 10 * 60 * 1000) {
			cache[`cronjob-${containerId}`] = Date.now()
			return true
		} else return false
	}

	private async lookupLocalAccessorHandle(
		/** The PackageContainer to create an AccessorHandle for */
		mainPackageContainers: Expectation.SpecificPackageContainerOnPackage.FileSource[],
		/** File Name (not a full path, just the basename) */
		fileName: string,
		/** The "other" PackageContainer to use for comparison */
		otherOperationPointer: OperationPointer
	) {
		// generate a random fileName to avoid collisions

		return lookupAccessorHandles<UniversalVersion>(
			this.parent.worker,
			mainPackageContainers,
			[otherOperationPointer.packageContainer],
			{ expectationId: this.exp.id },
			{
				filePath: `tmp_media_file_convert_${this.parent.workId}_${fileName}`,
			},
			{
				requiredForPlayout: this.exp.workOptions.requiredForPlayout,
				useTemporaryFilePath: false,
			},
			{
				write: true,
				writePackageContainer: true,
			}
		)
	}
}
interface OperationPointer {
	lookup: LookupFilePackageContainer<UniversalVersion>
	packageContainer: PackageContainerOnPackage
	isTemporary: boolean
}
