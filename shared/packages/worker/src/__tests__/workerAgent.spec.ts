import { describe, expect, vi, beforeAll, beforeEach, it } from 'vitest'
import type { Mock, MockedObject } from '@vitest/spy'

import { protectString } from '@sofie-automation/server-core-integration'
import { ClientConnectionOptions, LoggerInstance, WorkerConfig, clearPrometheusRegistry } from '@sofie-package-manager/api'
import { WorkforceAPI } from '../workforceApi.js'
import { ExpectationManagerAPI } from '../expectationManagerApi.js'

vi.mock('../workforceApi.ts', () => {
	return {
		WorkforceAPI: vi.fn().mockImplementation(function () {
			let onConnected: (() => void) | null = null
			return {
				on: function (event: string, cb: (...args: any[]) => void) {
					if (event === 'connected') {
						onConnected = cb
					}
				},
				init: function () {
					return Promise.resolve().then(() => {
						onConnected?.()
					})
				},
				getExpectationManagerList: function () {
					const o = setup()
					return [
						{
							id: 'expectation-manager-id',
							urls: o.expectationManagerAccessURLs,
						},
					]
				},
			}
		}),
	}
})

const mockInit = vi.fn(function (_connectionOptions: ClientConnectionOptions, _clientMethods: any) {
	return Promise.resolve()
})

vi.mock('../expectationManagerApi.ts', () => {
	return {
		ExpectationManagerAPI: vi.fn().mockImplementation(function () {
			return {
				on: function (_event: string, _cb: (...args: any[]) => void) {
					// do nothing
				},
				init: mockInit,
			}
		}),
	}
})

import { WorkerAgent } from '../workerAgent.js'

beforeAll(() => {
	vi.useFakeTimers()
})

beforeEach(() => {
	clearPrometheusRegistry()
	mockInit.mockClear()
	;(WorkforceAPI as any as MockedObject<WorkforceAPI>).mockClear()
	;(ExpectationManagerAPI as any as vi.Mock<ExpectationManagerAPI>).mockClear()
})

describe('WorkerAgent', () => {
	it('Connects to the ExpectationManager via the correct URL for a given networkId', async () => {
		const o = setup()
		const workerAgent = new WorkerAgent(o.logger, {
			...o.workerConfig,
			worker: {
				...o.workerConfig.worker,
				networkIds: ['net2'],
			},
		} satisfies WorkerConfig)
		await workerAgent.init()

		expect(WorkforceAPI).toHaveBeenCalledTimes(1)
		expect((WorkforceAPI as any as MockedObject<WorkforceAPI>).mock.calls[0][0]).toBe(o.workerConfig.worker.workerId)

		expect(mockInit).toHaveBeenCalledTimes(1)
		expect(mockInit.mock.calls[0][0]).toMatchObject({
			type: 'websocket',
			url: o.expectationManagerAccessURLs['net2'],
		})
	})
	it('Connects to the ExpectationManager via the fallback URL if no networkIds provided', async () => {
		const o = setup()
		const workerAgent = new WorkerAgent(o.logger, {
			...o.workerConfig,
			worker: {
				...o.workerConfig.worker,
				networkIds: [],
			},
		} satisfies WorkerConfig)
		await workerAgent.init()

		expect(WorkforceAPI).toHaveBeenCalledTimes(1)
		expect((WorkforceAPI as any as vi.Mock<WorkforceAPI>).mock.calls[0][0]).toBe(o.workerConfig.worker.workerId)

		expect(mockInit).toHaveBeenCalledTimes(1)
		expect(mockInit.mock.calls[0][0]).toMatchObject({
			type: 'websocket',
			url: o.expectationManagerAccessURLs['*'],
		})
	})
	it('Connects to the ExpectationManager via the fallback URL if no URLs matching the networkIds found', async () => {
		const o = setup()
		const workerAgent = new WorkerAgent(o.logger, {
			...o.workerConfig,
			worker: {
				...o.workerConfig.worker,
				networkIds: ['net-nonexistent'],
			},
		} satisfies WorkerConfig)
		await workerAgent.init()

		expect(WorkforceAPI).toHaveBeenCalledTimes(1)
		expect((WorkforceAPI as any as vi.Mock<WorkforceAPI>).mock.calls[0][0]).toBe(o.workerConfig.worker.workerId)

		expect(mockInit).toHaveBeenCalledTimes(1)
		expect(mockInit.mock.calls[0][0]).toMatchObject({
			type: 'websocket',
			url: o.expectationManagerAccessURLs['*'],
		})
	})
})

function setup() {
	const logger = {
		error: vi.fn((...args) => console.log(...args)),
		warn: vi.fn((...args) => console.log(...args)),
		help: vi.fn((...args) => console.log(...args)),
		data: vi.fn((...args) => console.log(...args)),
		info: vi.fn((...args) => console.log(...args)),
		debug: vi.fn((...args) => console.log(...args)),
		prompt: vi.fn((...args) => console.log(...args)),
		http: vi.fn((...args) => console.log(...args)),
		verbose: vi.fn((...args) => console.log(...args)),
		input: vi.fn((...args) => console.log(...args)),
		silly: vi.fn((...args) => console.log(...args)),
	} as any as LoggerInstance
	logger.category = () => logger

	const workerConfig = {
		process: {
			logLevel: 'debug',
			certificates: [],
			unsafeSSL: false,
			logPath: undefined,
		},
		worker: {
			appContainerURL: '', // do not connect to AppContainer in this test
			workerId: protectString<any>('worker'),
			considerCPULoad: null,
			costMultiplier: 1,
			failurePeriod: 0,
			failurePeriodLimit: 0,
			networkIds: [],
			pickUpCriticalExpectationsOnly: false,
			resourceId: 'res1',
			workforceURL: 'ws:workforce.local',
			sourcePackageStabilityThreshold: 0,
			executableAliases: {},
			temporaryFolderPath: undefined,
			windowsDriveLetters: undefined,
			allowedExpectationTypes: null,
			matchFilenamesWithoutExtension: false,
		},
		health: {
			port: null,
		},
	} satisfies WorkerConfig

	const expectationManagerAccessURLs = {
		net1: 'ws://expectation-manager.net1.local',
		net2: 'ws://expectation-manager.net2.local',
		'*': 'ws://expectation-manager.public',
	}

	return {
		logger,
		workerConfig,
		expectationManagerAccessURLs,
	}
}
