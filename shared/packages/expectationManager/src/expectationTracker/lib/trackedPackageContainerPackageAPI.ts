// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { TrackedExpectation } from '../../lib/trackedExpectation'
import { ExpectationTracker } from '../expectationTracker'

/** Various methods related to TrackedPackageContainerPackageAPI (i.e. a Package in a certain PackageContainer) */
export class TrackedPackageContainerPackageAPI {
	constructor(private tracker: ExpectationTracker) {}

	public updatePackageContainerPackageStatus(trackedExp: TrackedExpectation, isRemoved: boolean): void {
		for (const fromPackage of trackedExp.exp.fromPackages) {
			// Note: If an expectation is from multiple packages and one of them is removed,
			// it'll result in reportPackageContainerPackageStatus() never being called for that package.
			// This situation is handled by PackageManager.removeInvalidPackageContainerPackageStatus().

			for (const packageContainer of trackedExp.exp.endRequirement.targets) {
				if (isRemoved) {
					this.tracker.callbacks.reportPackageContainerPackageStatus(
						packageContainer.containerId,
						fromPackage.id,
						null
					)
				} else {
					this.tracker.callbacks.reportPackageContainerPackageStatus(
						packageContainer.containerId,
						fromPackage.id,
						{
							contentVersionHash: trackedExp.status.actualVersionHash || '',
							progress: trackedExp.status.workProgress || 0,
							status: this.getPackageStatus(trackedExp),
							statusReason: trackedExp.reason,
							priority: trackedExp.exp.priority,

							isPlaceholder: !!trackedExp.status.sourceIsPlaceholder,
						}
					)
				}
			}
		}
	}
	/** Convert expectation status to ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus */
	private getPackageStatus(
		trackedExp: TrackedExpectation
	): ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus {
		if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
			return ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
			return trackedExp.status.targetCanBeUsedWhileTransferring
				? ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.TRANSFERRING_READY
				: ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.TRANSFERRING_NOT_READY
		} else {
			if (trackedExp.status.sourceIsPlaceholder) {
				return ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.PLACEHOLDER
			} else if (trackedExp.status.sourceExists) {
				return ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_READY
			} else {
				return ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_FOUND
			}
		}
	}
}
