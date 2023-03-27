import { GenericWorker } from '../../../worker'
import { UniversalVersion, getStandardCost, compareActualExpectVersions } from '../lib/lib'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	Accessor,
	Expectation,
	hashObj,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from '@sofie-package-manager/api'
import {
	isFileShareAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'

/**
 * Verifies that a file exists on the target. Doesn't actually perform any work, just verifies that the file exists on the target,
 */
export const FileVerify: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: undefined,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isFileVerify(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isFileVerify(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		return {
			ready: true,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		_wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFullfilled> => {
		if (!isFileVerify(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				fulfilled: false,
				reason: {
					user: `Not able to access target, due to: ${lookupTarget.reason.user} `,
					tech: `Not able to access target: ${lookupTarget.reason.tech}`,
				},
			}

		const issuePackage = await lookupTarget.handle.checkPackageReadAccess()
		if (!issuePackage.success) {
			return {
				fulfilled: false,
				reason: {
					user: `Target package: ${issuePackage.reason.user}`,
					tech: `Target package: ${issuePackage.reason.tech}`,
				},
			}
		}

		// Check that the version of the target file is correct:
		const actualTargetVersion = await lookupTarget.handle.getPackageActualVersion()

		const compareVersionResult = compareActualExpectVersions(actualTargetVersion, exp.endRequirement.version)
		if (!compareVersionResult.success) {
			return {
				fulfilled: false,
				reason: {
					user: `Target version is wrong: ${compareVersionResult.reason.user}`,
					tech: `${compareVersionResult.reason.tech}`,
				},
			}
		}

		return {
			fulfilled: true,
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isFileVerify(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		// Since we only verify the existence of the file (in isExpectationFullfilled), we don't need to do anything here.

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		const targetHandle = lookupTarget.handle
		if (
			lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
			lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
			lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY
		) {
			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPProxyAccessorHandle(targetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

			const workInProgress = new WorkInProgress({ workLabel: 'Verifying file' }, async () => {
				// on cancel, doing nothing
			}).do(async () => {
				// done
				const actualTargetVersion = await lookupTarget.handle.getPackageActualVersion()
				const actualSourceVersionHash = hashObj(actualTargetVersion)

				workInProgress._reportComplete(
					actualSourceVersionHash,
					{
						user: `Verification done`,
						tech: `Completed`,
					},
					undefined
				)
			})

			return workInProgress
		} else {
			throw new Error(`FileVerify.workOnExpectation: Unsupported accessor target "${lookupTarget.accessor.type}"`)
		}
	},
	removeExpectation: async (exp: Expectation.Any, _worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isFileVerify(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Don't do anything upon removal.

		return {
			removed: true,
		}
	},
}
function isFileVerify(exp: Expectation.Any): exp is Expectation.FileVerify {
	return exp.type === Expectation.Type.FILE_VERIFY
}

async function lookupTargets(
	worker: GenericWorker,
	exp: Expectation.FileVerify
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.endRequirement.targets,
		exp.endRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
		}
	)
}
