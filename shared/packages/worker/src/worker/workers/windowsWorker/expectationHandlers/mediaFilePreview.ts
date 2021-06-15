import { Accessor } from '@sofie-automation/blueprints-integration'
import { GenericWorker } from '../../../worker'
import { getStandardCost } from '../lib/lib'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from '@shared/api'
import {
	isFileShareAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { FFMpegProcess, runffMpeg } from './lib/ffmpeg'
import { WindowsWorker } from '../windowsWorker'

/**
 * Generates a low-res preview video of a source video file, and stores the resulting file into the target PackageContainer
 */
export const MediaFilePreview: ExpectationWindowsHandler = {
	doYouSupportExpectation(
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	): ReturnTypeDoYouSupportExpectation {
		if (!windowsWorker.hasFFMpeg)
			return {
				support: false,
				reason: {
					user: 'There is an issue with the Worker: FFMpeg not found',
					tech: 'Cannot access FFMpeg executable',
				},
			}
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success) return { ready: false, reason: tryReading.reason }

		return {
			ready: true,
			sourceExists: true,
			// reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		_wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFullfilled> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready)
			return {
				fulfilled: false,
				reason: {
					user: `Not able to access source, due to ${lookupSource.reason.user}`,
					tech: `Not able to access source: ${lookupSource.reason.tech}`,
				},
			}
		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				fulfilled: false,
				reason: {
					user: `Not able to access target, due to ${lookupTarget.reason.user}`,
					tech: `Not able to access target: ${lookupTarget.reason.tech}`,
				},
			}

		const issueReadPackage = await lookupTarget.handle.checkPackageReadAccess()
		if (!issueReadPackage.success)
			return {
				fulfilled: false,
				reason: {
					user: `Issue with target: ${issueReadPackage.reason.user}`,
					tech: `Issue with target: ${issueReadPackage.reason.tech}`,
				},
			}

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)

		const metadata = await lookupTarget.handle.fetchMetadata()

		if (!metadata) {
			return {
				fulfilled: false,
				reason: { user: `The preview needs to be re-generated`, tech: `No preview metadata file found` },
			}
		} else if (metadata.sourceVersionHash !== actualSourceVersionHash) {
			return {
				fulfilled: false,
				reason: {
					user: `The preview needs to be re-generated`,
					tech: `Preview version doesn't match source file`,
				},
			}
		} else {
			return {
				fulfilled: true,
				// reason: { user: `Preview already matches preview file`, tech: `Preview already matches preview file` },
			}
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const startTime = Date.now()

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle

		if (
			lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY)
		) {
			// We can read the source and write the preview directly.
			if (!isLocalFolderAccessorHandle(sourceHandle)) throw new Error(`Source AccessHandler type is wrong`)
			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPProxyAccessorHandle(targetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

			let ffMpegProcess: FFMpegProcess | undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Generating preview' }, async () => {
				// On cancel
				ffMpegProcess?.cancel()
			}).do(async () => {
				const tryReadPackage = await sourceHandle.checkPackageReadAccess()
				if (!tryReadPackage.success) throw new Error(tryReadPackage.reason.tech)

				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const actualSourceVersionHash = hashObj(actualSourceVersion)
				// const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

				const metadata: Metadata = {
					sourceVersionHash: actualSourceVersionHash,
					version: {
						...{
							// Default values:
							type: Expectation.Version.Type.MEDIA_FILE_PREVIEW,
							bitrate: '40k',
							width: 190,
							height: -1,
						},
						...exp.endRequirement.version,
					},
				}

				await targetHandle.removePackage()

				const args = [
					'-hide_banner',
					'-y', // Overwrite output files without asking.
					'-threads 1', // Number of threads to use
					`-i "${sourceHandle.fullPath}"`, // Input file path
					'-f webm', // format: webm
					'-an', // blocks all audio streams
					'-c:v libvpx', // encoder for video
					`-b:v ${metadata.version.bitrate || '40k'}`,
					'-auto-alt-ref 0',
					`-vf scale=${metadata.version.width || 190}:${metadata.version.height || -1}`, // Scale to resolution
					'-deadline realtime', // Encoder speed/quality and cpu use (best, good, realtime)
				]

				ffMpegProcess = await runffMpeg(
					workInProgress,
					args,
					targetHandle,
					actualSourceVersionHash,
					async () => {
						// Called when ffmpeg has finished
						ffMpegProcess = undefined
						await targetHandle.finalizePackage()
						await targetHandle.updateMetadata(metadata)

						const duration = Date.now() - startTime
						workInProgress._reportComplete(
							actualSourceVersionHash,
							{
								user: `Preview generation completed in ${Math.round(duration / 100) / 10}s`,
								tech: `Completed at ${Date.now()}`,
							},
							undefined
						)
					}
				)
			})

			return workInProgress
		} else {
			throw new Error(
				`MediaFilePreview.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready) {
			return {
				removed: false,
				reason: {
					user: `Can't access target, due to: ${lookupTarget.reason.user}`,
					tech: `No access to target: ${lookupTarget.reason.tech}`,
				},
			}
		}

		try {
			await lookupTarget.handle.removePackage()
		} catch (err) {
			return {
				removed: false,
				reason: {
					user: `Cannot remove file due to an internal error`,
					tech: `Cannot remove preview file: ${err.toString()}`,
				},
			}
		}

		return {
			removed: true,
			// reason: { user: ``, tech: `Removed preview file "${exp.endRequirement.content.filePath}" from target` },
		}
	},
}
function isMediaFilePreview(exp: Expectation.Any): exp is Expectation.MediaFilePreview {
	return exp.type === Expectation.Type.MEDIA_FILE_PREVIEW
}

interface Metadata {
	sourceVersionHash: string
	version: Expectation.Version.MediaFilePreview
}

function lookupPreviewSources(
	worker: GenericWorker,
	exp: Expectation.MediaFilePreview
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(
		worker,
		exp.startRequirement.sources,
		exp.startRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
			packageVersion: exp.startRequirement.version,
		}
	)
}
function lookupPreviewTargets(
	worker: GenericWorker,
	exp: Expectation.MediaFilePreview
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(
		worker,
		exp.endRequirement.targets,
		exp.endRequirement.content,
		exp.workOptions,
		{
			write: true,
			writePackageContainer: true,
		}
	)
}
