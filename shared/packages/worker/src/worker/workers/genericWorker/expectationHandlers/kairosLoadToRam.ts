import { BaseWorker } from '../../../worker'
import { UniversalVersion, getStandardCost } from '../lib/lib'
import {
	Accessor,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	stringifyError,
} from '@sofie-package-manager/api'
import { isKairosClipAccessorHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { ExpectationHandlerGenericWorker } from '../genericWorker'
// eslint-disable-next-line node/no-missing-import
import { assertNever, MediaObject, MediaStatus } from 'kairos-connection'

/**
 * Loads a ramrec/still into RAM on a Kairos.
 * Expects that the ramrec/still is already present on the Kairos (can be uploaded via FTP).
 */
export const KairosLoadToRam: ExpectationHandlerGenericWorker = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: BaseWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: undefined,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isKairosLoadToRam(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isKairosLoadToRam(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready)
			return { ready: lookupTarget.ready, knownReason: lookupTarget.knownReason, reason: lookupTarget.reason }

		return {
			ready: true,
		}
	},
	isExpectationFulfilled: async (
		exp: Expectation.Any,
		_wasFulfilled: boolean,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isKairosLoadToRam(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				fulfilled: false,
				knownReason: lookupTarget.knownReason,
				reason: {
					user: `Not able to access target, due to: ${lookupTarget.reason.user} `,
					tech: `Not able to access target: ${lookupTarget.reason.tech}`,
				},
			}

		if (!isKairosClipAccessorHandle(lookupTarget.handle)) {
			return {
				fulfilled: false,
				knownReason: true,
				reason: {
					user: `Internal Error: Wrong type of accessor!`,
					tech: `Expected a Kairos accessor, got ${lookupTarget.handle.type}`,
				},
			}
		}

		const issuePackage = await lookupTarget.handle.checkPackageReadAccess()
		if (!issuePackage.success) {
			return {
				fulfilled: false,
				knownReason: issuePackage.knownReason,
				reason: {
					user: `Target package: ${issuePackage.reason.user}`,
					tech: `Target package: ${issuePackage.reason.tech}`,
				},
			}
		}

		// Since this expectation only supports a specific type of accessor, we can do some specialized checks:
		const status = await lookupTarget.handle.getMediaStatus()
		if (status?.status !== MediaStatus.LOAD) {
			return {
				fulfilled: false,
				knownReason: true,
				reason: {
					user: `Is not loaded in RAM`,
					tech: `Is not loaded in RAM`,
				},
			}
		}

		return {
			fulfilled: true,
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<IWorkInProgress> => {
		if (!isKairosLoadToRam(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		const targetHandle = lookupTarget.handle
		if (lookupTarget.accessor.type === Accessor.AccessType.KAIROS_CLIP) {
			if (!isKairosClipAccessorHandle(targetHandle)) throw new Error(`Target AccessHandler type is wrong`)

			let checkInterval: NodeJS.Timeout | null = null
			let cancelled = false
			const workInProgress = new WorkInProgress({ workLabel: 'Upload to RAM' }, async () => {
				// on cancel
				cancelled = true
				if (checkInterval) {
					clearInterval(checkInterval)
				}
			}).do(async () => {
				// Start upload
				await targetHandle.uploadToRAM()

				// Check status
				checkInterval = setInterval(() => {
					targetHandle
						.getMediaStatus()
						.then((status: MediaObject | undefined) => {
							if (cancelled) {
								if (checkInterval !== null) clearInterval(checkInterval)
								return
							}
							if (status?.status === MediaStatus.LOADING) {
								workInProgress._reportProgress(null, status.loadProgress)
							} else {
								// All other statuses means we should stop checking:
								if (checkInterval !== null) clearInterval(checkInterval)

								if (status === undefined) {
									workInProgress._reportError({
										user: `Error when loading into RAM: clip not found`,
										tech: `Clip "${targetHandle.packageName}" not found`,
									})
								} else if (status.status === MediaStatus.ERROR) {
									workInProgress._reportError({
										user: `Error when loading into RAM: Error in Kairos`,
										tech: `Kairos Error when loading into RAM (at loadProgress ${status.loadProgress})`,
									})
								} else if (status.status === MediaStatus.LOAD) {
									workInProgress._reportComplete(
										'',
										{
											user: `Loaded into RAM`,
											tech: `Completed`,
										},
										undefined
									)
								} else if (status.status === MediaStatus.NOT_LOADED) {
									// Nothing?

									workInProgress._reportError({
										user: `Error when loading into RAM: Unhandled returned status`,
										tech: `Unhandled status: ${JSON.stringify(status)}`,
									})
								} else {
									assertNever(status.status)
								}
							}
						})
						.catch((err) => {
							workInProgress._reportError(err)
						})
				}, 500)
			})

			return workInProgress
		} else {
			throw new Error(`FileVerify.workOnExpectation: Unsupported accessor target "${lookupTarget.accessor.type}"`)
		}
	},
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
		if (!isKairosLoadToRam(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupTargets(worker, exp)
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

		if (!isKairosClipAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)
		try {
			await lookupTarget.handle.unloadFromRAM(reason)
		} catch (err) {
			return {
				removed: false,
				knownReason: false,
				reason: {
					user: `Cannot unload from RAM due to an internal error`,
					tech: `Cannot unload from RAM : ${stringifyError(err)}`,
				},
			}
		}

		return {
			removed: true,
		}
	},
}
function isKairosLoadToRam(exp: Expectation.Any): exp is Expectation.FileVerify {
	return exp.type === Expectation.Type.PACKAGE_KAIROS_LOAD_TO_RAM
}

async function lookupTargets(
	worker: BaseWorker,
	exp: Expectation.FileVerify
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.endRequirement.targets,
		exp.startRequirement.sources,
		{ expectationId: exp.id },
		exp.endRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
		}
	)
}
