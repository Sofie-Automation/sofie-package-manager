import { LoggerInstance } from '@sofie-package-manager/api'

/** A generic file access handler to handle basic file operations */
export interface GenericFileHandler {
	logOperation: (message: string) => void
	logger: LoggerInstance
	getFullPath: (filePath: string) => string
	unlinkIfExists: (fullPath: string) => Promise<boolean>
	getMetadataPath: (fullPath: string) => string
	fileExists: (fullPath: string) => Promise<boolean>
	readFile: (fullPath: string) => Promise<Buffer>
	writeFile: (fullPath: string, content: Buffer) => Promise<void>
	listFilesInDir: (fullPath: string) => Promise<
		{
			name: string
			isDirectory: boolean
			/** unix timestamp */
			lastModified: number | undefined
		}[]
	>
	removeDirIfExists: (fullPath: string) => Promise<boolean>

	// Optional methods to override default behavior
	getPackagesToRemove?: () => Promise<DelayPackageRemovalEntry[]>
	storePackagesToRemove?: (packagesToRemove: DelayPackageRemovalEntry[]) => Promise<void>
}

export interface DelayPackageRemovalEntry {
	/** Local file path */
	filePath: string
	/** Unix timestamp for when it's clear to remove the file */
	removeTime: number
}
