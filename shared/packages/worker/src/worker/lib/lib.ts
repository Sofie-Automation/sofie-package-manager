import {
	Accessor,
	AccessorId,
	AccessorOnPackage,
	PackageContainerOnPackage,
	assertNever,
	objectEntries,
} from '@sofie-package-manager/api'

// TODO: This should be changed at some point,
// as the "cost" isn't really for a source or a target, but rather for the combination of the two as a pair.

function getAccessorTypePriority(accessor: AccessorOnPackage.Any): number {
	// Note: Lower is better
	if (!accessor.type) return 99999

	if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
		return 0
	} else if (accessor.type === Accessor.AccessType.QUANTEL) {
		return 1
	} else if (accessor.type === Accessor.AccessType.FILE_SHARE) {
		return 2
	} else if (accessor.type === Accessor.AccessType.HTTP_PROXY) {
		// a local url should be preferred:
		const isLocal = !!`${accessor.baseUrl}`.match(/localhost|127\.0\.0\.1/)
		if (isLocal) return 2.9
		return 3
	} else if (accessor.type === Accessor.AccessType.HTTP) {
		// a local url should be preferred:
		const isLocal = !!`${accessor.baseUrl}`.match(/localhost|127\.0\.0\.1/)
		if (isLocal) return 3.9
		return 4
	} else if (accessor.type === Accessor.AccessType.FTP) {
		return 5
	} else if (accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO) {
		return 99999
	} else if (accessor.type === Accessor.AccessType.ATEM_MEDIA_STORE) {
		return 99999
	} else {
		assertNever(accessor.type)
		return 99999
	}
}

/** Returns the PackageContainer Accessor which is the cheapest/best to use */
export function prioritizeAccessors<T extends PackageContainerOnPackage>(
	packageContainers: T[]
): AccessorWithPackageContainer<T>[] {
	const accessors: AccessorWithPackageContainer<T>[] = []
	for (const packageContainer of packageContainers) {
		for (const [accessorId, accessor] of objectEntries<AccessorId, AccessorOnPackage.Any>(
			packageContainer.accessors
		)) {
			accessors.push({
				packageContainer,
				accessor,
				accessorId,
				prio: getAccessorTypePriority(accessor),
			})
		}
	}
	accessors.sort((a, b) => {
		// Sort by priority (lowest first):
		if (a.prio > b.prio) return 1
		if (a.prio < b.prio) return -1

		// Sort by container id:
		if (a.packageContainer.containerId > b.packageContainer.containerId) return 1
		if (a.packageContainer.containerId < b.packageContainer.containerId) return -1

		// Sort by accessor id:
		if (a.accessorId > b.accessorId) return 1
		if (a.accessorId < b.accessorId) return -1

		return 0
	})
	return accessors
}
export interface AccessorWithPackageContainer<T extends PackageContainerOnPackage> {
	packageContainer: T
	accessor: AccessorOnPackage.Any
	accessorId: AccessorId
	prio: number
}

/**
 * Maximum buffer when running child_process.execFile. Large spikes of data being sent over STDIO streams can overload
 * this buffer which will result in the child_process' termination. A large buffer (10M) allows us sufficient time to
 * process the incoming data.
 */
export const MAX_EXEC_BUFFER = 10_486_750

export function isEqual(a: unknown, b: unknown): boolean {
	if (typeof a === 'object' && typeof b === 'object') {
		if (Array.isArray(a)) {
			if (!Array.isArray(b)) return false

			// handle Arrays
			if (a.length !== b.length) return false

			for (let i = a.length - 1; i >= 0; i--) {
				if (!isEqual(a[i], b[i])) return false
			}
			return true
		} else {
			if (a === null || b === null) return a === b // handle null

			const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])

			for (const key of allKeys) {
				if (!isEqual((a as any)[key], (b as any)[key])) return false
			}
			return true
		}
	} else {
		return a === b
	}
}
