import {
	Expectation,
	ExpectationId,
	ExpectationManagerId,
	LoggerInstance,
	PackageContainerExpectation,
	PackageContainerId,
} from '@sofie-package-manager/api'

import {
	PackageManagerActivePlaylist,
	PackageManagerActiveRundown,
} from '@sofie-automation/shared-lib/dist/package-manager/publications'

import { PackageManagerSettings } from '../generated/options.js'
import { ExpectedPackageWrap, PackageContainers } from '../packageManager.js'

export interface GenerateExpectationApi {
	getExpectations: (
		logger: LoggerInstance,
		managerId: ExpectationManagerId,
		packageContainers: PackageContainers,
		_activePlaylist: PackageManagerActivePlaylist | null,
		activeRundowns: PackageManagerActiveRundown[],
		expectedPackages: ExpectedPackageWrap[],
		settings: PackageManagerSettings
	) => { [id: ExpectationId]: Expectation.Any }

	getPackageContainerExpectations: (
		managerId: ExpectationManagerId,
		packageContainers: PackageContainers,
		_activePlaylist: PackageManagerActivePlaylist | null
	) => { [id: PackageContainerId]: PackageContainerExpectation }
}
