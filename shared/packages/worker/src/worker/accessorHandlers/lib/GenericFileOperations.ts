import { Expectation, LoggerInstance, Reason, stringifyError } from '@sofie-package-manager/api'
import { JSONWriteHandler } from './json-write-file'
import { DelayPackageRemovalEntry, GenericFileHandler } from './GenericFileHandler'
import * as path from 'path'

/**
 * Provides a set of convenience methods for file-based operations
 */
export class GenericFileOperationsHandler {
	private readonly logger: LoggerInstance
	constructor(
		private readonly fileHandler: GenericFileHandler,
		private readonly jsonWriter: JSONWriteHandler,
		private readonly workOptions: Expectation.WorkOptions.RemoveDelay,
		logger: LoggerInstance
	) {
		this.logger = logger.category('GenericFileOpHandler')
	}

	/** Depending on workOptions removes a file, alternatively schedules it for later removal */
	async handleRemovePackage(filePath: string, packageName: string, reason: string): Promise<void> {
		if (this.workOptions.removeDelay) {
			await this.delayPackageRemoval(filePath, this.workOptions.removeDelay)
			this.fileHandler.logOperation(
				`Remove package: Delay remove package "${packageName}", delay: ${this.workOptions.removeDelay} (${reason})`
			)
		} else {
			const fullPath = this.fileHandler.getFullPath(filePath)
			const metadataFullPath = this.fileHandler.getMetadataPath(fullPath)
			await this.fileHandler.unlinkIfExists(metadataFullPath)

			if (await this.fileHandler.unlinkIfExists(fullPath)) {
				this.fileHandler.logOperation(`Remove package: Removed file "${packageName}" (${reason})`)
			} else {
				this.fileHandler.logOperation(`Remove package: File already removed "${packageName}" (${reason})`)
			}
		}
	}

	/** Clear a scheduled-later-removal of a package */
	async clearPackageRemoval(filePath: string): Promise<void> {
		await this.updatePackagesToRemove((packagesToRemove) => {
			return packagesToRemove.filter((entry) => entry.filePath !== filePath)
		})
	}
	/** Remove any packages that are due for removal */
	async removeDuePackages(): Promise<Reason | null> {
		const packagesToRemove = await this.getPackagesToRemove()

		const removedFilePaths: string[] = []
		for (const entry of packagesToRemove) {
			// Check if it is time to remove the package:
			if (entry.removeTime < Date.now()) {
				// it is time to remove this package
				const fullPath = this.fileHandler.getFullPath(entry.filePath)

				const metadataFullPath = this.fileHandler.getMetadataPath(fullPath)
				await this.fileHandler.unlinkIfExists(metadataFullPath)

				if (await this.fileHandler.unlinkIfExists(fullPath))
					this.fileHandler.logOperation(`Remove due packages: Removed file "${fullPath}"`)

				removedFilePaths.push(entry.filePath)
			}
		}

		if (removedFilePaths.length > 0) {
			// Update the list of packages to remove:
			await this.updatePackagesToRemove((packagesToRemove) => {
				// Remove the entries of the files we removed:
				return packagesToRemove.filter((entry) => !removedFilePaths.includes(entry.filePath))
			})
		}

		return null
	}

	/** Clean up (remove) files older than a certain time */
	async cleanupOldFiles(
		/** Remove files older than this age (in seconde) */
		cleanFileAge: number,
		folderPath: string
	): Promise<Reason | null> {
		// Check the config. 0 or -1 means it's disabled:
		if (cleanFileAge <= 0) {
			return {
				user: 'Internal error',
				tech: `cleanFileAge is ${cleanFileAge}`,
			}
		}

		const cleanUpDirectory = async (dirPath: string, removeEmptyDir: boolean) => {
			const now = Date.now()
			const dirFullPath = path.join(folderPath, dirPath)
			const files = await this.fileHandler.listFilesInDir(dirFullPath)

			if (files.length === 0) {
				if (removeEmptyDir) {
					this.fileHandler.logOperation(`Clean up old files: Remove empty dir "${dirFullPath}"`)
					await this.fileHandler.removeDirIfExists(dirFullPath)
				}
			} else {
				for (const file of files) {
					const filePath = path.join(dirPath, file.name)
					const fullPath = path.join(folderPath, filePath)
					if (file.isDirectory) {
						await cleanUpDirectory(filePath, true)
					} else if (file.lastModified && file.lastModified > 0) {
						const age = Math.floor((now - file.lastModified) / 1000) // in seconds

						if (age > cleanFileAge) {
							await this.fileHandler.unlinkIfExists(fullPath)
							this.fileHandler.logOperation(`Clean up old files: Remove file "${fullPath}" (age: ${age})`)
						}
					}
				}
			}
		}

		try {
			await cleanUpDirectory('', false)
		} catch (error) {
			return {
				user: 'Error when cleaning up files',
				tech: stringifyError(error),
			}
		}
		return null
	}

	/** Schedule the package for later removal */
	private async delayPackageRemoval(filePath: string, ttl: number): Promise<void> {
		await this.updatePackagesToRemove((packagesToRemove) => {
			// Search for a pre-existing entry:
			let alreadyExists = false
			for (const entry of packagesToRemove) {
				if (entry.filePath === filePath) {
					// extend the TTL if it was found:
					entry.removeTime = Date.now() + ttl

					alreadyExists = true
					break
				}
			}
			if (!alreadyExists) {
				packagesToRemove.push({
					filePath: filePath,
					removeTime: Date.now() + ttl,
				})
			}
			return packagesToRemove
		})
	}
	/** Full path to the file containing deferred removals */
	private get deferRemovePackagesPath(): string {
		return this.fileHandler.getFullPath('__removePackages.json')
	}
	/** */
	private async getPackagesToRemove(): Promise<DelayPackageRemovalEntry[]> {
		if (this.fileHandler.getPackagesToRemove) return this.fileHandler.getPackagesToRemove()

		const exists = await this.fileHandler.fileExists(this.deferRemovePackagesPath)
		if (!exists) return []
		const buf = await this.fileHandler.readFile(this.deferRemovePackagesPath)
		const text = buf.toString('utf8')
		if (text.length === 0) return []
		const packagesToRemove: DelayPackageRemovalEntry[] = JSON.parse(text)
		if (!Array.isArray(packagesToRemove)) return []
		return packagesToRemove
	}
	/** Update the deferred-remove-packages list */
	private async updatePackagesToRemove(
		cbManipulateList: (list: DelayPackageRemovalEntry[]) => DelayPackageRemovalEntry[]
	): Promise<void> {
		if (this.fileHandler.storePackagesToRemove && this.fileHandler.getPackagesToRemove) {
			// Override the default behavior with a custom implementation:
			const currentList = await this.fileHandler.getPackagesToRemove()
			const currentListLength = currentList.length
			const newList = cbManipulateList(currentList)
			if (newList.length !== currentListLength) await this.fileHandler.storePackagesToRemove(newList)
			return
		}

		// Note: It is high likelihood that several processes will try to write to this file at the same time
		// Therefore, we need to lock the file while writing to it.

		try {
			await this.jsonWriter.updateJSONFileBatch<DelayPackageRemovalEntry[]>(
				this.deferRemovePackagesPath,
				(list) => {
					const newList = cbManipulateList(list ?? [])
					if (newList.length === 0) return undefined // delete the file if the list is empty
					return newList
				}
			)
		} catch (e) {
			// Not much we can do about it..
			// Log and continue:
			this.logger.error('Error while updatePackagesToRemove')
			this.logger.error(stringifyError(e))
		}
	}
}
