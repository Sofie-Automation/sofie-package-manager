import { AppContainerId, AppId } from './ids'
import { WorkerAgentConfig } from './worker'

/** The AppContainer is a host application responsible for spawning other applications */

/** How often the appContainer expect to be pinged by its child apps */
export const APPCONTAINER_PING_TIME = 5000 // ms
export const APPCONTAINER_MAX_KEEPALIVE = 6 * 3600 * 1000 // ms (6 hours)

export interface AppContainerConfig {
	workforceURL: string | null
	port: number | null
	appContainerId: AppContainerId
	minRunningApps: number
	maxRunningApps: number
	maxAppKeepalive: number
	spinDownTime: number
	/** Minimum number of critical workers to spin up */
	minCriticalWorkerApps: number

	worker: {
		resourceId: string
		networkIds: string[]
		windowsDriveLetters: WorkerAgentConfig['windowsDriveLetters']
		temporaryFolderPath: WorkerAgentConfig['temporaryFolderPath']
		costMultiplier: number
		considerCPULoad: number | null
		failurePeriodLimit: number
		failurePeriod: number
	}
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace AppContainer {
	export type AppType = 'worker' // | other

	export enum Type {
		NODEJS = 'nodejs',
		// DOCKER = 'docker',
		// KUBERNETES = 'kubernetes',
	}

	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Generic {
		/** Information on how to access the AppContainer */
		export interface AppContainer {
			type: Type
		}

		/** Information about an App running in an AppContainer */
		export interface App {
			/** Uniquely identifies a running instance of an app. */
			appId: AppId
		}
	}

	/** NodeJS app container */
	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace NodeJS {
		export interface AppContainer extends Generic.AppContainer {
			/** URL to the REST interface */
			url: string
		}
		export interface App extends Generic.App {
			type: string // to be better defined later?
		}
	}
}
