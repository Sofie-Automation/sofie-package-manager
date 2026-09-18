import { expect, vi } from 'vitest'

vi.mock('@sofie-package-manager/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@sofie-package-manager/api')>()
	const mock = await import('../../__mocks__/@sofie-package-manager/api.ts')
	return {
		...actual,
		...mock,
	}
})

vi.mock('child_process', async () => {
	const mock = await import('../../__mocks__/child_process.ts')
	return mock
})

import {
	AppContainerConfig,
	AppContainerProcessConfig,
	LogLevel,
	ProcessConfig,
	initializeLogger,
	literal,
	protectString,
	setupLogger,
	WebsocketServer,
	WorkerAgentId,
	clearPrometheusRegistry,
} from '@sofie-package-manager/api'
// @ts-ignore mock
import { mockOnNewProcess, mockListAllProcesses, mockClearAllProcesses } from 'child_process'
import { AppContainer } from '../../appContainer.js'
import deepExtend from 'deep-extend'
import { WorkerAgentAPI } from '../../workerAgentApi.js'

export async function prepareTestEnviromnent(debugLogging: boolean): Promise<void> {
	const config: { process: ProcessConfig } = {
		process: {
			certificates: [],
			logPath: undefined,
			unsafeSSL: false,
			logLevel: debugLogging ? LogLevel.DEBUG : LogLevel.INFO,
		},
	}

	initializeLogger(config)
}

export async function setupAppContainer(partialAppContainerConfig: Partial<AppContainerConfig>): Promise<AppContainer> {
	const config = literal<AppContainerProcessConfig>({
		appContainer: deepExtend(
			{
				appContainerId: protectString('app0'),
				maxAppKeepalive: 1000,
				maxRunningApps: 10,
				minRunningApps: 1,
				port: 9090,
				spinDownTime: 1000,
				minCriticalWorkerApps: 0,
				worker: {
					considerCPULoad: null,
					costMultiplier: 1,
					networkIds: [],
					resourceId: '',
					windowsDriveLetters: [],
					temporaryFolderPath: '',
					matchFilenamesWithoutExtension: false,
					failurePeriod: 0,
					failurePeriodLimit: 0,
					executableAliases: {},
					sourcePackageStabilityThreshold: 0,
				},
				workforceURL: null,
			},
			partialAppContainerConfig
		),
		process: {
			certificates: [],
			logLevel: undefined,
			logPath: undefined,
			unsafeSSL: false,
		},
		health: {
			port: null,
		},
	})

	const logger = setupLogger(config, '', undefined, undefined, undefined, (level) => level === LogLevel.ERROR)

	return new AppContainer(logger, config)
}

export async function setupWorkers(): Promise<void> {
	mockOnNewProcess((cp: any) => {
		setImmediate(() => {
			const match = cp.args.find((arg: string) => arg.match(/--workerId=(\w+)/))
			expect(match).toBeTruthy()
			const workerIdMatch = match.match(/--workerId=(\w+)/)
			// @ts-ignore mock
			WebsocketServer.mockNewConnection(workerIdMatch[1], 'workerAgent')
		})
	})
}

export function getWorkerCount() {
	const processes = mockListAllProcesses()
	return processes.filter((item: any) => item.args.find((arg: string) => arg.match(/--workerId/))).length
}

export function getWorkerId(index: number): WorkerAgentId | undefined {
	//@ts-ignore mock
	return Object.keys(WorkerAgentAPI.mockAppContainer)[index]
}

export async function resetMocks(): Promise<void> {
	clearPrometheusRegistry()

	mockClearAllProcesses()
	//@ts-ignore mock
	WorkerAgentAPI.mockReset()
}
