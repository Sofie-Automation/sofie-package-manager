import { PackageContainer } from './inputApi'

/*
 * This file contains definitions for Package Container Expectations, an internal datastructure upon which the Package Manager operates.
 */

/** A PackageContainerExpectation defines what functionality to run for a Package Container. */
export interface PackageContainerExpectation extends PackageContainer {
	/** ID of the PackageContainer */
	id: string
	/** ID of the manager that created the expectation */
	managerId: string
	/** Defines which cronjobs are expected to run */
	cronjobs: {
		/** How often the cronjob should run (approximately) */
		interval?: number
		cleanup?: {
			label: string
			/** If set, untracked files will also be removed after this time (in seconds) */
			cleanFileAge?: number
		}
	}
	/** Defines which monitors are expected to run */
	monitors: {
		/** Monitor the packages of a PackageContainer */
		packages?: {
			label: string
			/** If set, ignore any files matching this. (Regular expression). */
			ignore?: string

			/** If set, the monitoring will be using polling */
			usePolling?: number | null
			/** If set, will set the awaitWriteFinish.StabilityThreshold of chokidar */
			awaitWriteFinishStabilityThreshold?: number | null

			/** What layers to set on the resulting ExpectedPackage */
			targetLayers: string[]

			/** What to set for sideEffect on the resulting ExpectedPackage */
			sideEffect?: any
		}
	}
}
