import { AccessorOnPackage } from '@sofie-package-manager/api'
import { AccessorHandlerCheckHandleReadResult, AccessorHandlerCheckHandleWriteResult } from '../genericHandle'
import { BaseWorker } from '../../worker'
import { compareResourceIds } from '../../workers/genericWorker/lib/lib'

export function defaultDoYouSupportAccess(worker: BaseWorker, accessor: AccessorOnPackage.Any): boolean {
	if ('resourceId' in accessor) {
		if (!compareResourceIds(accessor.resourceId, worker.agentAPI.location.localComputerId)) return false
	}

	if ('networkId' in accessor) {
		if (accessor.networkId && !worker.agentAPI.location.localNetworkIds.includes(accessor.networkId)) return false
	}

	return true
}
export function defaultCheckHandleRead(
	accessor: AccessorOnPackage.Any
): AccessorHandlerCheckHandleReadResult | undefined {
	if (!accessor.allowRead) {
		return {
			success: false,
			knownReason: true,
			reason: {
				user: `Not allowed to read (in configuration)`,
				tech: `Not allowed to read  (check PackageContainer settings)`,
			},
		}
	}
	return undefined
}
export function defaultCheckHandleWrite(
	accessor: AccessorOnPackage.Any
): AccessorHandlerCheckHandleWriteResult | undefined {
	if (!accessor.allowWrite) {
		return {
			success: false,
			knownReason: true,
			reason: {
				user: `Not allowed to write (in configuration)`,
				tech: `Not allowed to write (check PackageContainer settings)`,
			},
		}
	}
	return undefined
}
