import { describe, expect, vi, afterEach, beforeAll, it } from 'vitest'

vi.mock('child_process', async () => {
	const mock = await import('../__mocks__/child_process.ts')
	return mock
})
vi.mock('../workforceApi.ts', async () => {
	const mock = await import('../__mocks__/workforceApi.ts')
	return mock
})
vi.mock('../workerAgentApi.ts', async () => {
	const mock = await import('../__mocks__/workerAgentApi.ts')
	return mock
})

import { getWorkerCount, prepareTestEnviromnent, resetMocks, setupAppContainer, setupWorkers } from './lib/setupEnv.js'
import { sleep } from '@sofie-automation/server-core-integration'
import { WorkerAgentAPI } from '../workerAgentApi.js'

describe('Critical worker Apps', {
	timeout: 10_000
}, () => {
	beforeAll(async () => {
		await prepareTestEnviromnent(false)
	})

	afterEach(async () => {
		await resetMocks()
	})

	it('Spins up 2 critical expectaiton workers', async () => {
		const MIN_RUNNING_APPS = 0
		const MIN_CRITICAL_WORKER_APPS = 2
		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			minCriticalWorkerApps: MIN_CRITICAL_WORKER_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS + MIN_CRITICAL_WORKER_APPS)

		appContainer.terminate()
	})

	it('Spins up 2 critical expectaiton workers and one regular worker', async () => {
		const MIN_RUNNING_APPS = 1
		const MIN_CRITICAL_WORKER_APPS = 2
		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			minCriticalWorkerApps: MIN_CRITICAL_WORKER_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS + MIN_CRITICAL_WORKER_APPS)

		appContainer.terminate()
	})

	it('Refuses to spin down critical workers', async () => {
		const MIN_RUNNING_APPS = 0
		const MAX_RUNNING_APPS = 5
		const MIN_CRITICAL_WORKER_APPS = 1

		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			maxRunningApps: MAX_RUNNING_APPS,
			minCriticalWorkerApps: MIN_CRITICAL_WORKER_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		// Ensure that the initial state has settled
		await sleep(5000)

		expect(getWorkerCount()).toBe(MIN_CRITICAL_WORKER_APPS)

		//@ts-ignore mock
		await WorkerAgentAPI.mockAppContainer['app0_0'].requestSpinDown()

		expect(getWorkerCount()).toBe(MIN_CRITICAL_WORKER_APPS)

		appContainer.terminate()
	})
})
