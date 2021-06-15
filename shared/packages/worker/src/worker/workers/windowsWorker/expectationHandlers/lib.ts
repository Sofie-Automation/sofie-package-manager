import { AccessorOnPackage, PackageContainerOnPackage } from '@sofie-automation/blueprints-integration'
import { getAccessorHandle } from '../../../accessorHandlers/accessor'
import { prioritizeAccessors } from '../../../lib/lib'
import { GenericAccessorHandle } from '../../../accessorHandlers/genericHandle'
import { GenericWorker } from '../../../worker'
import { compareActualExpectVersions, findBestPackageContainerWithAccessToPackage } from '../lib/lib'
import { Diff } from 'deep-diff'
import { Expectation, Reason, ReturnTypeDoYouSupportExpectation } from '@shared/api'

/** Check that a worker has access to the packageContainers through its accessors */
export function checkWorkerHasAccessToPackageContainersOnPackage(
	genericWorker: GenericWorker,
	checks: {
		sources?: PackageContainerOnPackage[]
		targets?: PackageContainerOnPackage[]
	}
): ReturnTypeDoYouSupportExpectation {
	let accessSourcePackageContainer: ReturnType<typeof findBestPackageContainerWithAccessToPackage>
	// Check that we have access to the packageContainers
	if (checks.sources !== undefined) {
		accessSourcePackageContainer = findBestPackageContainerWithAccessToPackage(genericWorker, checks.sources)
		if (!accessSourcePackageContainer) {
			return {
				support: false,
				reason: {
					user: `There is an issue with the configuration of the Worker, it doesn't have access to any of the source PackageContainers`,
					tech: `Worker doesn't have access to any of the source packageContainers (${checks.sources
						.map((o) => o.containerId)
						.join(', ')})`,
				},
			}
		}
	}

	let accessTargetPackageContainer: ReturnType<typeof findBestPackageContainerWithAccessToPackage>
	if (checks.targets !== undefined) {
		accessTargetPackageContainer = findBestPackageContainerWithAccessToPackage(genericWorker, checks.targets)
		if (!accessTargetPackageContainer) {
			return {
				support: false,
				reason: {
					user: `There is an issue with the configuration of the Worker, it doesn't have access to any of the target PackageContainers`,
					tech: `Worker doesn't have access to any of the target packageContainers (${checks.targets
						.map((o) => o.containerId)
						.join(', ')})`,
				},
			}
		}
	}

	// const hasAccessTo: string[] = []
	// if (accessSourcePackageContainer) {
	// 	hasAccessTo.push(
	// 		`source "${accessSourcePackageContainer.packageContainer.label}" through accessor "${accessSourcePackageContainer.accessorId}"`
	// 	)
	// }
	// if (accessTargetPackageContainer) {
	// 	hasAccessTo.push(
	// 		`target "${accessTargetPackageContainer.packageContainer.label}" through accessor "${accessTargetPackageContainer.accessorId}"`
	// 	)
	// }

	return {
		support: true,
		// reason: `Has access to ${hasAccessTo.join(' and ')}`,
	}
}

export type LookupPackageContainer<Metadata> =
	| {
			ready: true
			accessor: AccessorOnPackage.Any
			handle: GenericAccessorHandle<Metadata>
			// reason: Reason
	  }
	| {
			ready: false
			accessor: undefined
			// handle: undefined
			reason: Reason
	  }
interface LookupChecks {
	/** Check that the accessor-handle supports reading */
	read?: boolean
	/** Check that the Package can be read */
	readPackage?: boolean
	/** Check that the version of the Package is correct */
	packageVersion?: Expectation.Version.ExpectAny

	/** Check that the accessor-handle supports writing */
	write?: boolean
	/** Check that it is possible to write to write to the package container */
	writePackageContainer?: boolean
}
/** Go through the Accessors and return the best one that we can use for the expectation */
export async function lookupAccessorHandles<Metadata>(
	worker: GenericWorker,
	packageContainers: PackageContainerOnPackage[],
	expectationContent: unknown,
	expectationWorkOptions: unknown,
	checks: LookupChecks
): Promise<LookupPackageContainer<Metadata>> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | Reason = { user: 'No target found', tech: 'No target found' }

	// See if the file is available at any of the targets:
	for (const { packageContainer, accessorId, accessor } of prioritizeAccessors(packageContainers)) {
		errorReason = undefined

		const handle = getAccessorHandle<Metadata>(
			worker,
			accessorId,
			accessor,
			expectationContent,
			expectationWorkOptions
		)

		if (checks.read) {
			// Check that the accessor-handle supports reading:
			const readResult = handle.checkHandleRead()
			if (!readResult.success) {
				errorReason = {
					user: `There is an issue with the configuration for the PackageContainer "${
						packageContainer.label
					}" (on accessor "${accessor.label || accessorId}"): ${readResult.reason.user}`,
					tech: `${packageContainer.label}: Accessor "${accessor.label || accessorId}": ${
						readResult.reason.tech
					}`,
				}
				continue // Maybe next accessor works?
			}
		}

		if (checks.readPackage) {
			// Check that the Package can be read:
			const readResult = await handle.checkPackageReadAccess()
			if (!readResult.success) {
				errorReason = {
					user: `Can't read the Package from PackageContainer "${packageContainer.label}" (on accessor "${
						accessor.label || accessorId
					}"), due to: ${readResult.reason.user}`,
					tech: `${packageContainer.label}: Accessor "${accessor.label || accessorId}": ${
						readResult.reason.tech
					}`,
				}

				continue // Maybe next accessor works?
			}
		}
		if (checks.packageVersion !== undefined) {
			// Check that the version of the Package is correct:
			const actualSourceVersion = await handle.getPackageActualVersion()

			const compareVersionResult = compareActualExpectVersions(actualSourceVersion, checks.packageVersion)
			if (!compareVersionResult.success) {
				errorReason = {
					user: `Won't read from the package, due to: ${compareVersionResult.reason.user}`,
					tech: `${packageContainer.label}: Accessor "${accessor.label || accessorId}": ${
						compareVersionResult.reason.tech
					}`,
				}
				continue // Maybe next accessor works?
			}
		}

		if (checks.write) {
			// Check that the accessor-handle supports writing:
			const writeResult = handle.checkHandleWrite()
			if (!writeResult.success) {
				errorReason = {
					user: `There is an issue with the configuration for the PackageContainer "${
						packageContainer.label
					}" (on accessor "${accessor.label || accessorId}"): ${writeResult.reason.user}`,
					tech: `${packageContainer.label}: lookupTargets: Accessor "${accessor.label || accessorId}": ${
						writeResult.reason.tech
					}`,
				}
				continue // Maybe next accessor works?
			}
		}
		if (checks.writePackageContainer) {
			// Check that it is possible to write to write to the package container:
			const writeAccessResult = await handle.checkPackageContainerWriteAccess()
			if (!writeAccessResult.success) {
				errorReason = {
					user: `Can't write to the PackageContainer "${packageContainer.label}" (on accessor "${
						accessor.label || accessorId
					}"), due to: ${writeAccessResult.reason.user}`,
					tech: `${packageContainer.label}: Accessor "${accessor.label || accessorId}": ${
						writeAccessResult.reason.tech
					}`,
				}
				continue // Maybe next accessor works?
			}
		}

		if (!errorReason) {
			// All good, no need to look further:
			return {
				accessor: accessor,
				handle: handle,
				ready: true,
				// reason: `Can access target "${packageContainer.label}" through accessor "${
				// 	accessor.label || accessorId
				// }"`,
			}
		}
	}
	return {
		accessor: undefined,
		ready: false,
		reason: errorReason,
	}
}
export function waitTime(duration: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, duration)
	})
}
/** Converts a diff to some kind of user-readable string */
export function userReadableDiff<T>(diffs: Diff<T, T>[]): string {
	const strs: string[] = []
	for (const diff of diffs) {
		if (diff.kind === 'A') {
			// array
			// todo: deep explanation for arrays?
			strs.push((diff.path ? diff.path?.join('.') : '??') + `[${diff.index}]:` + '>>Array differs<<')
		} else if (diff.kind === 'E') {
			// edited
			strs.push((diff.path ? diff.path?.join('.') : '??') + `:"${diff.lhs}" not equal to "${diff.rhs}"`)
		} else if (diff.kind === 'D') {
			// deleted
			strs.push((diff.path ? diff.path?.join('.') : '??') + `:deleted`)
		} else if (diff.kind === 'N') {
			// new
			strs.push((diff.path ? diff.path?.join('.') : '??') + `:added`)
		}
	}
	return strs.join(', ')
}
function padTime(time: number, pad: number): string {
	return time.toString().padStart(pad, '0')
}
/** Formats a duration (in milliseconds) to a timecode ("00:00:00.000") */
export function formatTimeCode(duration: number): string {
	const SECOND = 1000
	const MINUTE = 60 * SECOND
	const HOUR = 60 * MINUTE

	const hours = Math.floor(duration / HOUR)
	duration -= hours * HOUR

	const minutes = Math.floor(duration / MINUTE)
	duration -= minutes * MINUTE

	const seconds = Math.floor(duration / SECOND)
	duration -= seconds * SECOND

	return `${padTime(hours, 2)}:${padTime(minutes, 2)}:${padTime(seconds, 2)}.${padTime(duration, 3)}`
}
