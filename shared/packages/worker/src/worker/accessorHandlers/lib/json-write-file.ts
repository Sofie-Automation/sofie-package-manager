// import { promises as fs } from 'fs'
import * as LockFile from 'proper-lockfile'
import { GenericFileHandler } from './GenericFileHandler'
import { LoggerInstance } from '@sofie-package-manager/api'

export abstract class JSONWriteHandler {
	/** How long to wait a before trying again, in case of a failed write lock. Defaults to 100 ms. */
	public RETRY_TIMEOUT = 100 // ms
	/** How many times to wait a before trying again, in case of a failed write lock. Defaults to 10. */
	public LOCK_ATTEMPTS_COUNT = 10

	private readonly updateJSONFileBatches = new Map<string, BatchOperation>()

	protected logger: LoggerInstance

	constructor(protected fileHandler: GenericFileHandler, logger: LoggerInstance) {
		this.logger = logger.category('JSONWriteHandler')
	}

	abstract updateJSONFile<T>(
		filePath: string,
		/**
		 * Callback to modify the JSON value.
		 * @returns The value to write to the file (or undefined to remove the file)
		 */
		cbManipulate: (oldValue: T | undefined) => T | undefined
	): Promise<void>

	/**
	 * Read a JSON file, created by updateJSONFile()
	 */
	protected async readJSONFile(filePath: string): Promise<
		| {
				str: string
				value: any
		  }
		| undefined
	> {
		try {
			const str = await this.readIfExists(filePath)
			if (str !== undefined) {
				return { str, value: str ? JSON.parse(str) : undefined }
			}
		} catch (e) {
			// file data is corrupt, log and continue
			this.logger.error('Unable to read JSON file')
			this.logger.error(e)
		}

		// Second try; Check if there is a temporary file, to use instead?
		try {
			const tmpPath = JSONWriteHandler.getTmpPath(filePath)

			const str = await this.readIfExists(tmpPath)
			if (str !== undefined) {
				return { str, value: str ? JSON.parse(str) : undefined }
			}
		} catch (e) {
			this.logger.error('Unable to read tmp-JSON file')
			this.logger.error(e)
			// file data is corrupt, return undefined then
			return undefined
		}

		return undefined
	}

	/** Like updateJSONFile() but allow for multiple manipulations to be batched together and executed sequentially */
	async updateJSONFileBatch<T>(
		filePath: string,

		/**
		 * Callback to modify the JSON value.
		 * @returns The value to write to the file (or undefined to remove the file)
		 */
		cbManipulate: (oldValue: T | undefined) => T | undefined
	): Promise<void> {
		// Add manipulator callback to queue:

		const openBatch = this.updateJSONFileBatches.get(filePath)

		if (!openBatch) {
			// Start a new batch:

			const newBatch: BatchOperation = {
				callbacks: [cbManipulate],
				promise: this.updateJSONFile(filePath, (oldValue: T | undefined) => {
					// At this point, no more callbacks can be added, so we close the batch:

					// Guard against this being called multiple times:
					if (this.updateJSONFileBatches.get(filePath) === newBatch) {
						this.updateJSONFileBatches.delete(filePath)
					}

					// Execute all callbacks in the batch:
					let value = oldValue
					for (cbManipulate of newBatch.callbacks) {
						value = cbManipulate(value)
					}
					return value
				}),
			}
			this.updateJSONFileBatches.set(filePath, newBatch)

			await newBatch.promise
		} else {
			// There is a batch open for new callbacks. Add the callback to the batch:
			openBatch.callbacks.push(cbManipulate)
			await openBatch.promise
		}
	}

	protected async sleep(duration: number): Promise<void> {
		return new Promise((r) => setTimeout(r, duration))
	}
	protected async readIfExists(filePath: string): Promise<string | undefined> {
		const buf = await this.fileHandler.readFileIfExists(filePath)
		if (buf) return buf.toString('utf-8')
		else return undefined
	}
	protected async rename(from: string, to: string): Promise<void> {
		try {
			await this.fileHandler.rename(from, to)
		} catch (e) {
			if ((e as any)?.code === 'EPERM') {
				// Permission denied, wait a little bit and try again:
				await this.sleep(10)

				await this.rename(from, to)
			} else throw e
		}
	}
	static getTmpPath(filePath: string): string {
		return filePath + '.tmp'
	}
}

/**
 * This class provides a "safe" way to write JSON data to a file. Takes measures to avoid writing corrupt data to a file due to
 * 1. Multiple processes writing to the same file (uses a lock file)
 * 2. Writing corrupt files due to process exit (write to temporary file and rename)
 */
export class JSONWriteFilesLockHandler extends JSONWriteHandler {
	/**
	 * A "safe" way to write JSON data to a file. Takes measures to avoid writing corrupt data to a file due to
	 * 1. Multiple processes writing to the same file (uses a lock file)
	 * 2. Writing corrupt files due to process exit (write to temporary file and rename)
	 */
	async updateJSONFile<T>(
		filePath: string,
		/**
		 * Callback to modify the JSON value.
		 * @returns The value to write to the file (or undefined to remove the file)
		 */
		cbManipulate: (oldValue: T | undefined) => T | undefined
	): Promise<void> {
		const tmpFilePath = JSONWriteHandler.getTmpPath(filePath)
		let lockCompromisedError: Error | undefined = undefined

		// Retry up to 10 times at locking and writing the file:
		for (let i = 0; i < this.LOCK_ATTEMPTS_COUNT; i++) {
			lockCompromisedError = undefined

			// Get file lock
			let releaseLock: (() => Promise<void>) | undefined = undefined
			try {
				releaseLock = await LockFile.lock(filePath, {
					onCompromised: (err) => {
						// This is called if the lock somehow gets compromised

						this.logger.warn(`Lock compromised: ${err}`)
						lockCompromisedError = err
					},
				})
			} catch (e) {
				if ((e as any).code === 'ENOENT') {
					// The file does not exist. Create an empty file and try again:

					await this.fileHandler.writeFile(filePath, Buffer.from(''))
					continue
				} else if ((e as any).code === 'ELOCKED') {
					// Already locked, try again later:
					await this.sleep(this.RETRY_TIMEOUT)
					continue
				} else {
					// Unknown error.
					throw e
				}
			}

			// At this point, we have acquired the lock.
			try {
				// Read and write to the file:
				const oldValue = await this.readJSONFile(filePath)

				const newValue = cbManipulate(oldValue?.value)
				const newValueStr = newValue !== undefined ? JSON.stringify(newValue) : ''

				if (oldValue?.str === newValueStr) {
					// do nothing
				} else {
					if (lockCompromisedError) {
						// The lock was compromised. Try again:
						continue
					}

					const fileData = Buffer.from(newValueStr, 'utf-8')

					// Note: We can't unlink the file anywhere in here, or other calls to Lockfile can break
					// by overwriting the file with an empty one.

					// Write to a temporary file first, to avoid corrupting the file in case of a process exit:
					await this.fileHandler.writeFile(tmpFilePath, fileData)

					// Rename file:
					await this.rename(tmpFilePath, filePath)

					try {
						// Rename file:
						await this.rename(tmpFilePath, filePath)
					} catch (e) {
						// If renaming fails, try writing directly to the file instead:
						await this.fileHandler.writeFile(filePath, fileData)
						await this.fileHandler.unlinkIfExists(tmpFilePath)
					}
				}

				// Release the lock:
				if (!lockCompromisedError) await releaseLock()
				// Done, exit the function:
				return
			} catch (e) {
				if ((e as any).code === 'ERELEASED') {
					// Lock was already released. Something must have gone wrong (eg. someone deleted a folder),
					// Log and try again:
					this.logger.warn(`Lock was already released`)
					continue
				} else {
					// Release the lock:
					if (!lockCompromisedError) await releaseLock()
					throw e
				}
			}
		}
		// At this point, the lock failed

		if (lockCompromisedError) {
			this.logger.error(`lockCompromisedError: ${lockCompromisedError}`)
		}
		throw new Error(`Failed to lock file "${filePath}" after ${this.LOCK_ATTEMPTS_COUNT} attempts`)
	}
}

interface BatchOperation {
	/** Resolves when the batch operation has finished */
	promise: Promise<void>
	callbacks: ((oldValue: any | undefined) => any | undefined)[]
}

/**
 * This class is worse but more generic/compatible than JSONWriteFilesLockHandler
 */
export class JSONWriteFilesBestEffortHandler extends JSONWriteHandler {
	/**
	 * A "safe" way to write JSON data to a file. Takes measures to avoid writing corrupt data to a file due to
	 * 1. Multiple processes writing to the same file (uses a lock file)
	 * 2. Writing corrupt files due to process exit (write to temporary file and rename)
	 */
	async updateJSONFile<T>(
		filePath: string,
		/**
		 * Callback to modify the JSON value.
		 * @returns The value to write to the file (or undefined to remove the file)
		 */
		cbManipulate: (oldValue: T | undefined) => T | undefined
	): Promise<void> {
		const tmpFilePath = JSONWriteHandler.getTmpPath(filePath)
		const fileLockPath = filePath + '.lock'

		// Before locking the file for writing, we can do a quick check to see if we
		// want to do anything at all:
		{
			// Read the JSON file:
			const oldValue0 = await this.readJSONFile(filePath)

			const newValue = cbManipulate(oldValue0?.value)
			const newValueStr = newValue !== undefined ? JSON.stringify(newValue) : ''

			if (oldValue0?.str === newValueStr) {
				// do nothing
				return
			}
		}

		// Acquire a lock on the file:

		let acquiredLock = false

		for (let i = 0; i < this.LOCK_ATTEMPTS_COUNT; i++) {
			const lockFileContentStr = await this.readIfExists(fileLockPath)
			let lockFileContent: LockFileContent | undefined = undefined
			if (lockFileContentStr) {
				try {
					lockFileContent = JSON.parse(lockFileContentStr)
				} catch {
					// ignore
				}
			}
			if (lockFileContent) {
				const lockedDate = new Date(lockFileContent.date)

				if (Math.abs(Date.now() - lockedDate.getTime()) < 10 * 1000) {
					// The lock file is not too old, so we can use it.
					// Try again later:
					await this.sleep(this.RETRY_TIMEOUT)
					continue
				} else {
					this.logger.warn(
						`Lock file is invalid, removing... (${lockFileContent.date}) (${lockFileContentStr})`
					)
					// The lock file is invalid, remove it:
					await this.fileHandler.unlinkIfExists(fileLockPath)
				}
			}

			// Create a new lock file:
			const myLockFileContents = JSON.stringify({
				date: new Date().toISOString(),
				uniqueId: Math.random().toString(36),
			})
			await this.fileHandler.writeFile(fileLockPath, Buffer.from(myLockFileContents, 'utf-8'))
			// Wait a little bit to ensure that we got the lock:
			await this.sleep(this.RETRY_TIMEOUT * 2)

			const checkLockFileContent = await this.readIfExists(fileLockPath)
			if (checkLockFileContent !== myLockFileContents) {
				// Dang it, someone else got the lock before us.
				// Try again later:
				await this.sleep(this.RETRY_TIMEOUT)
				continue
			}

			acquiredLock = true
			break
		}

		if (!acquiredLock) {
			throw new Error(`Failed to lock file "${filePath}" after ${this.LOCK_ATTEMPTS_COUNT} attempts`)
		}

		// At this point, we have acquired the lock.

		// Read the JSON file:
		const oldValue = await this.readJSONFile(filePath)

		const newValue = cbManipulate(oldValue?.value)
		const newValueStr = newValue !== undefined ? JSON.stringify(newValue) : undefined

		if (oldValue?.str === newValueStr) {
			// do nothing
		} else {
			if (newValueStr === undefined) {
				// undefined means remove the file
				await this.fileHandler.unlinkIfExists(tmpFilePath)
				await this.fileHandler.unlinkIfExists(filePath)
			} else {
				const fileData = Buffer.from(newValueStr, 'utf-8')
				// Write to a temporary file first, to avoid corrupting the file in case of a process exit:
				await this.fileHandler.writeFile(tmpFilePath, fileData)

				try {
					// Rename file:
					await this.rename(tmpFilePath, filePath)
				} catch (e) {
					// Renaming failed.
					// (rename might not be supported on all file systems, such as some ftp servers)
					// Instead, try writing directly to the file instead:
					await this.fileHandler.writeFile(filePath, fileData)
					await this.fileHandler.unlinkIfExists(tmpFilePath)
				}
			}
		}

		// Release lock:
		await this.fileHandler.unlinkIfExists(fileLockPath)
	}
}

interface LockFileContent {
	date: string // ISO date string
	uniqueId: string // Unique ID to identify the lock
}
