import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'

import { ExpectationTracker } from '../expectationTracker/expectationTracker.js'
import { InternalManager } from '../internalManager/internalManager.js'
import { TrackedExpectation } from '../lib/trackedExpectation.js'
import { EvaluationRunner } from './evaluationRunner.js'

export interface EvaluateContext {
	manager: InternalManager
	tracker: ExpectationTracker
	runner: EvaluationRunner
	trackedExp: TrackedExpectation
	timeSinceLastEvaluation: number
}

export function assertState(
	trackedExp: TrackedExpectation,
	expectState: ExpectedPackageStatusAPI.WorkStatusState
): void {
	if (trackedExp.state !== expectState)
		throw new Error(`Internal Error: The state was supposed to be "${expectState}" but is "${trackedExp.state}"`)
}
