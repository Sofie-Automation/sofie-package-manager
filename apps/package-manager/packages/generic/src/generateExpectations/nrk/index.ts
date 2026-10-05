import { GenerateExpectationApi } from '../api.js'
import { getExpectations } from './expectations.js'
import { getPackageContainerExpectations } from './packageContainerExpectations.js'

export const api: GenerateExpectationApi = {
	getExpectations: getExpectations,
	getPackageContainerExpectations: getPackageContainerExpectations,
}
