import { Expectation } from '@sofie-package-manager/api'
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import { ExpectationTrackerConstants } from './constants'
import { TrackedExpectation } from '../expectationTracker'

export function sortTrackedExpectations(
	trackedExpectations: { [id: string]: TrackedExpectation },
	constants: ExpectationTrackerConstants
): TrackedExpectation[] {
	const tracked: TrackedExpectation[] = Object.values(trackedExpectations)
	tracked.sort((a, b) => {
		const aLastErrorTime: number = a.lastError?.time ?? 0
		const bLastErrorTime: number = b.lastError?.time ?? 0

		// If the expectation had an error recently, it should be prioritized down:
		const aHadRecentError: boolean = Date.now() - aLastErrorTime < constants.ERROR_WAIT_TIME
		const bHadRecentError: boolean = Date.now() - bLastErrorTime < constants.ERROR_WAIT_TIME

		if (aHadRecentError && !bHadRecentError) return 1
		if (!aHadRecentError && bHadRecentError) return -1

		// Lowest priority first
		if (a.exp.priority > b.exp.priority) return 1
		if (a.exp.priority < b.exp.priority) return -1

		// Lowest lastErrorTime first, this is to make it so that if one expectation fails, it'll not block all the others
		if (aLastErrorTime > bLastErrorTime) return 1
		if (aLastErrorTime < bLastErrorTime) return -1

		// Lowest lastOperationTime first
		if (a.lastEvaluationTime > b.lastEvaluationTime) return 1
		if (a.lastEvaluationTime < b.lastEvaluationTime) return -1

		return 0
	})
	return tracked
}
export function getDefaultTrackedExpectation(
	exp: Expectation.Any,
	existingtrackedExp?: TrackedExpectation
): TrackedExpectation {
	return {
		id: exp.id,
		exp: exp,
		state: existingtrackedExp?.state || ExpectedPackageStatusAPI.WorkStatusState.NEW,
		queriedWorkers: {},
		availableWorkers: {},
		noAvailableWorkersReason: {
			user: 'Unknown reason',
			tech: 'N/A (init)',
		},
		lastEvaluationTime: 0,
		waitingForWorkerTime: null,
		noWorkerAssignedTime: null,
		errorCount: 0,
		lastError: null,
		errorOnRemoveCount: 0,
		reason: {
			user: '',
			tech: '',
		},
		prevStatusReasons: existingtrackedExp?.prevStatusReasons || {},
		status: {},
		session: null,
	}
}

/** Convert expectation status to ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus */
export function getPackageStatus(
	trackedExp: TrackedExpectation
): ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus {
	if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
		return ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
	} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
		return trackedExp.status.targetCanBeUsedWhileTransferring
			? ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.TRANSFERRING_READY
			: ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.TRANSFERRING_NOT_READY
	} else {
		return trackedExp.status.sourceExists
			? ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_READY
			: ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_FOUND
	}
}
