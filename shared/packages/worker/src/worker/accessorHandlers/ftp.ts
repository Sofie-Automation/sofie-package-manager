import {
	GenericAccessorHandle,
	PackageReadInfo,
	PackageReadStream,
	PutPackageHandler,
	SetupPackageContainerMonitorsResult,
	AccessorHandlerRunCronJobResult,
	AccessorHandlerCheckHandleReadResult,
	AccessorHandlerCheckHandleWriteResult,
	AccessorHandlerCheckPackageContainerWriteAccessResult,
	AccessorHandlerCheckPackageReadAccessResult,
	AccessorHandlerTryPackageReadResult,
	PackageOperation,
	AccessorHandlerCheckHandleBasicResult,
	AccessorConstructorProps,
} from './genericHandle'
import {
	Accessor,
	AccessorOnPackage,
	Expectation,
	PackageContainerExpectation,
	assertNever,
	Reason,
	MonitorId,
} from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import * as path from 'path'
import * as FTP from 'basic-ftp'
import { MonitorInProgress } from '../lib/monitorInProgress'
import { defaultCheckHandleRead, defaultCheckHandleWrite, defaultDoYouSupportAccess } from './lib/lib'

import { isEqual } from '../lib/lib'
import { FTPClient, FTPClientBase, FTPOptions, SFTPClient } from './lib/FTPClient'
import { GenericFileOperationsHandler } from './lib/GenericFileOperations'
import { GenericFileHandler } from './lib/GenericFileHandler'
import { JSONWriteFilesBestEffortHandler } from './lib/json-write-file'

export interface Content {
	/** This is set when the class-instance is only going to be used for PackageContainer access.*/
	onlyContainerAccess?: boolean
	filePath?: string
	path?: string
}

/** Accessor handle for accessing files in a local folder */
export class FTPAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'ftp'
	private readonly content: Content
	private readonly workOptions: Expectation.WorkOptions.RemoveDelay & Expectation.WorkOptions.UseTemporaryFilePath
	private readonly accessor: AccessorOnPackage.FTP

	public fileHandler: GenericFileOperationsHandler

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.FTP>) {
		super({
			...arg,
			type: FTPAccessorHandle.type,
		})
		this.accessor = arg.accessor
		this.content = arg.content
		this.workOptions = arg.workOptions

		if (this.workOptions.removeDelay && typeof this.workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')
		if (this.workOptions.useTemporaryFilePath && typeof this.workOptions.useTemporaryFilePath !== 'boolean')
			throw new Error('Bad input data: workOptions.useTemporaryFilePath is not a boolean!')

		const fileHandler: GenericFileHandler = {
			logOperation: this.logOperation.bind(this),
			unlinkIfExists: this.unlinkIfExists.bind(this),
			getFullPath: this.getFullPath.bind(this),
			getMetadataPath: this.getMetadataPath.bind(this),
			fileExists: this.fileExists.bind(this),
			readFile: this.readFile.bind(this),
			readFileIfExists: this.readFileIfExists.bind(this),
			writeFile: this.writeFile.bind(this),
			listFilesInDir: this.listFilesInDir.bind(this),
			removeDirIfExists: this.removeDirIfExists.bind(this),
			rename: this.rename.bind(this),
		}

		const jsonWriter = this.worker.cacheData(this.type, 'jsonWriter', () => {
			return new JSONWriteFilesBestEffortHandler(fileHandler, this.worker.logger)
		})
		this.fileHandler = new GenericFileOperationsHandler(
			fileHandler,
			jsonWriter,
			this.workOptions,
			this.worker.logger
		)
	}
	static doYouSupportAccess(worker: BaseWorker, accessor: AccessorOnPackage.Any): boolean {
		return defaultDoYouSupportAccess(worker, accessor)
	}
	get packageName(): string {
		return this.filePath
	}
	checkHandleBasic(): AccessorHandlerCheckHandleBasicResult {
		if (this.accessor.type !== Accessor.AccessType.FTP) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `FTP Accessor type is not FTP ("${this.accessor.type}")!`,
				},
			}
		}
		// Note: For the FTP-accessor, we allow this.accessor.basePath to be empty/falsy
		// (which means that the content path needs to be a full URL)

		if (!this.content.onlyContainerAccess) {
			if (!this.filePath)
				return {
					success: false,
					knownReason: true,
					reason: {
						user: `path not set`,
						tech: `path not set`,
					},
				}
		}

		return { success: true }
	}
	checkHandleRead(): AccessorHandlerCheckHandleReadResult {
		const defaultResult = defaultCheckHandleRead(this.accessor)
		if (defaultResult) return defaultResult
		return { success: true }
	}
	checkHandleWrite(): AccessorHandlerCheckHandleWriteResult {
		const defaultResult = defaultCheckHandleWrite(this.accessor)
		if (defaultResult) return defaultResult
		return { success: true }
	}
	async checkPackageReadAccess(): Promise<AccessorHandlerCheckPackageReadAccessResult> {
		const ftp = await this.prepareFTPClient()

		const response = await ftp.fileExists(this.fullPath)

		if (response.exists) {
			return { success: true }
		} else {
			return { success: false, reason: response.reason, knownReason: response.knownReason }
		}
	}
	async tryPackageRead(): Promise<AccessorHandlerTryPackageReadResult> {
		const ftp = await this.prepareFTPClient()

		const response = await ftp.getFileInfo(this.fullPath)

		if (response.success) {
			return { success: true }
		} else {
			return {
				success: false,
				reason: response.reason,
				knownReason: response.knownReason,
				packageExists: response.packageExists,
			}
		}
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerCheckPackageContainerWriteAccessResult> {
		return { success: true }
	}
	private async checkPackageContainerReadAccess(): Promise<AccessorHandlerRunCronJobResult> {
		return { success: true }
	}
	async getPackageActualVersion(): Promise<Expectation.Version.FTPFile> {
		const ftp = await this.prepareFTPClient()

		const response = await ftp.getFileInfo(this.fullPath)

		if (response.success) {
			return {
				type: Expectation.Version.Type.FTP_FILE,
				fileSize: response.fileInfo.size,
				modifiedDate: response.fileInfo.modified,
			}
		} else throw new Error(`getPackageActualVersion: ${response.reason.user}: ${response.reason.tech}`)
	}
	async ensurePackageFulfilled(): Promise<void> {
		await this.fileHandler.clearPackageRemoval(this.filePath)
	}
	async removePackage(reason: string): Promise<void> {
		await this.fileHandler.handleRemovePackage(this.filePath, this.packageName, reason)
	}
	async getPackageReadStream(): Promise<PackageReadStream> {
		const ftp = await this.prepareFTPClient()

		const response = await ftp.download(this.fullPath)

		response.onComplete.catch((e) => {
			this.worker.logger.error(`getPackageReadStream: Error when downloading FTP stream: ${e.message}`)
		})

		return {
			readStream: response.readableStream,
			cancel: () => {
				ftp.abort().catch((e) => {
					this.worker.logger.error(`getPackageReadStream: Error when aborting FTP stream: ${e.message}`)
				})
			},
		}
	}
	async putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		const ftp = await this.prepareFTPClient()

		const fullPath = this.workOptions.useTemporaryFilePath ? this.temporaryFilePath : this.fullPath

		// Remove the file if it exists:
		await this.unlinkIfExists(fullPath)

		const streamWrapper: PutPackageHandler = new PutPackageHandler(() => {
			// abort:
			ftp.abort().catch((e) => {
				this.worker.logger.error(`getPackageReadStream: Error when aborting FTP stream: ${e.message}`)
			})
		})

		const pResponse = ftp.upload(sourceStream, fullPath)

		pResponse
			.then((response) => {
				if (response !== null) {
					streamWrapper.emit('error', new Error(`FTP upload failed: ${response}`))
				} else {
					// All good:
					streamWrapper.emit('close')
				}
			})
			.catch((err) => {
				streamWrapper.emit('error', new Error(`FTP upload threw for path "${fullPath}": ${err}`))
			})

		// Pipe any events from the writeStream right into the wrapper:
		// writeStream.on('error', (err) => streamWrapper.emit('error', err))
		// writeStream.on('close', () => streamWrapper.emit('close'))

		return streamWrapper
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('FTP.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		// await this.removeDeferRemovePackage()
		throw new Error('FTP.putPackageInfo: Not supported')
	}
	async prepareForOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>
	): Promise<PackageOperation> {
		await this.fileHandler.clearPackageRemoval(this.filePath)
		return this.logWorkOperation(operationName, source, this.packageName)
	}
	async finalizePackage(operation: PackageOperation): Promise<void> {
		operation.logDone()

		if (this.workOptions.useTemporaryFilePath) {
			const ftp = await this.prepareFTPClient()

			// Remove the file if it exists:
			if (await ftp.removeFileIfExists(this.fullPath)) {
				this.logOperation(`Finalize package: Remove file "${this.fullPath}"`)
			}

			await ftp.renameFile(this.temporaryFilePath, this.fullPath)
			this.logOperation(`Finalize package: Rename file "${this.temporaryFilePath}" to "${this.fullPath}"`)
		}
	}

	// Note: We handle metadata by storing a metadata json-file to the side of the file.

	async fetchMetadata(): Promise<Metadata | undefined> {
		const ftp = await this.prepareFTPClient()

		// The file exists
		if (await this.fileExists(this.metadataPath)) {
			const buffer = await ftp.downloadContent(this.metadataPath)

			const text = buffer.toString('utf-8')

			return JSON.parse(text)
		} else return undefined
	}
	async updateMetadata(metadata: Metadata): Promise<void> {
		await this.writeFile(this.metadataPath, JSON.stringify(metadata))
	}
	async removeMetadata(): Promise<void> {
		const ftp = await this.prepareFTPClient()

		await ftp.removeFileIfExists(this.metadataPath)
	}

	async runCronJob(packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerRunCronJobResult> {
		// Always check read/write access first:
		const checkRead = await this.checkPackageContainerReadAccess()
		if (!checkRead.success) return checkRead

		if (this.accessor.allowWrite) {
			const checkWrite = await this.checkPackageContainerWriteAccess()
			if (!checkWrite.success) return checkWrite
		}

		let badReason: Reason | null = null
		const cronjobs = Object.keys(packageContainerExp.cronjobs) as (keyof PackageContainerExpectation['cronjobs'])[]
		for (const cronjob of cronjobs) {
			if (cronjob === 'interval') {
				// ignore
			} else if (cronjob === 'cleanup') {
				const options = packageContainerExp.cronjobs[cronjob]

				badReason = await this.fileHandler.removeDuePackages()
				if (!badReason && options?.cleanFileAge)
					badReason = await this.fileHandler.cleanupOldFiles(options.cleanFileAge, this.basePath)
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of cronjobs are handled:
				assertNever(cronjob)
			}
		}

		if (!badReason) return { success: true }
		else return { success: false, knownReason: false, reason: badReason }
	}
	async setupPackageContainerMonitors(
		packageContainerExp: PackageContainerExpectation
	): Promise<SetupPackageContainerMonitorsResult> {
		const resultingMonitors: Record<MonitorId, MonitorInProgress> = {}
		const monitorIds = Object.keys(
			packageContainerExp.monitors
		) as (keyof PackageContainerExpectation['monitors'])[]
		for (const monitorIdStr of monitorIds) {
			if (monitorIdStr === 'packages') {
				throw new Error('Not implemented yet')
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of monitors are handled:
				assertNever(monitorIdStr)
			}
		}

		return { success: true, monitors: resultingMonitors }
	}
	get fullPath(): string {
		return this.getFullPath(this.filePath)
	}
	/** Full path to a temporary file */
	get temporaryFilePath(): string {
		return this.fullPath + '.pmtemp'
	}
	/** Full path to the metadata file */
	private get metadataPath() {
		return this.fullPath + '_metadata.json'
	}

	private get basePath(): string {
		// Returns base path, beginning with '/'
		let basePath = this.accessor.basePath ?? '/'
		if (!basePath.startsWith('/')) basePath = '/' + basePath // Ensure it starts with a forward slash
		return (
			basePath
				// Ensure forward slashes:
				.replace(/\\/g, '/')
		)
	}
	get filePath(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')
		const filePath = this._getFilePath()
		if (!filePath) throw new Error(`FTPAccessorHandle: path not set!`)
		return filePath
	}
	get ftpOptions(): {
		serverType: Accessor.FTP['serverType']
		host: string
		port: number
		username: string
		password: string
		allowAnyCertificate: boolean
	} {
		const serverType = this.accessor.serverType
		const host = this.accessor.host
		const port = this.accessor.port ?? (this.accessor.serverType === 'ftp' ? 21 : 22) // default port for FTP is 21, SFTP is 22
		const username = this.accessor.username
		const password = this.accessor.password

		const allowAnyCertificate = this.accessor.allowAnyCertificate ?? false

		if (serverType === undefined) throw new Error('FTPAccessorHandle: serverType is not set!')
		if (host === undefined) throw new Error('FTPAccessorHandle: host is not set!')
		if (username === undefined) throw new Error('FTPAccessorHandle: username is not set!')
		if (password === undefined) throw new Error('FTPAccessorHandle: password is not set!')

		return {
			serverType,
			host,
			port,
			username,
			password,
			allowAnyCertificate,
		}
	}

	get ftpUrl(): {
		url: string
		/** safe for logging / labels */
		safeUrl: string
	} {
		let url: string

		const ftpOptions = this.ftpOptions

		// Note: this is untested:
		if (ftpOptions.serverType === 'ftp') {
			url = `ftp://`
		} else if (ftpOptions.serverType === 'sftp') {
			url = `sftp://`
		} else if (ftpOptions.serverType === 'ftps') {
			url = `ftps://`
		} else {
			assertNever(ftpOptions.serverType)
			throw new Error(`Unsupported FTP server type "${ftpOptions.serverType}"`)
		}
		url += `${ftpOptions.username}:${ftpOptions.password}@${ftpOptions.host}:${ftpOptions.port}${this.fullPath}`

		return {
			url,
			safeUrl: url.replace(`:${ftpOptions.password}@`, 'PASSWORD'),
		}
	}

	private async prepareFTPClient(): Promise<FTPClientBase> {
		const cacheKey = `${this.accessor.serverType}-${this.accessor.host}-${this.accessor.port ?? 21}/${
			this.accessor.basePath ?? '/'
		}`

		const ftpOptions = this.ftpOptions

		const options: FTPOptions = {
			type: Accessor.AccessType.FTP,
			serverType: ftpOptions.serverType,
			host: ftpOptions.host,
			port: ftpOptions.port,
			username: ftpOptions.username,
			password: ftpOptions.password,
			allowAnyCertificate: ftpOptions.allowAnyCertificate,
		}

		let cachedClient = this.worker.accessorCache[cacheKey] as FTPClientBase | undefined

		if (cachedClient?.destroyed) {
			delete this.worker.accessorCache[cacheKey]
			cachedClient = undefined
		}
		if (cachedClient) {
			// Check that options matches:
			if (!isEqual(cachedClient.options, options)) {
				await cachedClient.destroy()
				delete this.worker.accessorCache[cacheKey]
				cachedClient = undefined
			}
		}
		if (!cachedClient) {
			// Set up a new FTP client:
			if (ftpOptions.serverType === 'ftp' || ftpOptions.serverType === 'ftps') {
				cachedClient = new FTPClient(this.worker.logger, options)
			} else if (ftpOptions.serverType === 'sftp') {
				cachedClient = new SFTPClient(this.worker.logger, options)
			} else {
				assertNever(ftpOptions.serverType)
			}
		}

		if (cachedClient) {
			await cachedClient.init()

			this.worker.accessorCache[cacheKey] = cachedClient
			return cachedClient
		} else {
			throw new Error(`FTPAccessorHandle: Could not create FTP client for ${ftpOptions.serverType}`)
		}
	}
	/** Full path to the metadata file */
	private getMetadataPath(fullUrl: string) {
		return fullUrl + '_metadata.json'
	}
	private _getFilePath(): string | undefined {
		return this.accessor.path || this.content.filePath || this.content.path
	}

	getFullPath(filePath: string): string {
		// Returns full path, beginning with '/'
		return (
			path
				.join(this.basePath, filePath)
				// Ensure forward slashes:
				.replace(/\\/g, '/')
		)
	}
	async unlinkIfExists(fullPath: string): Promise<boolean> {
		const ftp = await this.prepareFTPClient()
		return ftp.removeFileIfExists(fullPath)
	}
	async fileExists(fullPath: string): Promise<boolean> {
		const ftp = await this.prepareFTPClient()
		const response = await ftp.fileExists(fullPath)
		return response.exists
	}
	async readFile(fullPath: string): Promise<Buffer> {
		const ftp = await this.prepareFTPClient()
		return ftp.downloadContent(fullPath)
	}
	async readFileIfExists(fullPath: string): Promise<Buffer | undefined> {
		try {
			return await this.readFile(fullPath)
		} catch (e) {
			if (e instanceof FTP.FTPError) {
				if (e.code === 550) {
					// 550 means "File not found"
					return undefined
				}
			} else if (e instanceof Error && e.message.includes('File not found')) {
				return undefined
			}
			throw e // rethrow other errors
		}
	}
	async writeFile(fullPath: string, content: Buffer | string): Promise<void> {
		const ftp = await this.prepareFTPClient()
		await ftp.uploadContent(fullPath, content)
	}
	async listFilesInDir(fullPath: string): Promise<
		{
			name: string
			isDirectory: boolean
			lastModified: number | undefined
		}[]
	> {
		const ftp = await this.prepareFTPClient()
		return ftp.listFilesInDir(fullPath)
	}
	async removeDirIfExists(fullPath: string): Promise<boolean> {
		const ftp = await this.prepareFTPClient()
		return ftp.removeDirIfExists(fullPath)
	}
	async rename(from: string, to: string): Promise<void> {
		const ftp = await this.prepareFTPClient()
		return ftp.renameFile(from, to)
	}
}
