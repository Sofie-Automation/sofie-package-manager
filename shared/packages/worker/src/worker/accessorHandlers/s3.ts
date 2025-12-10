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
	AccessorHandlerCheckHandleCompatibilityResult,
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
import { MonitorInProgress } from '../lib/monitorInProgress'
import { defaultCheckHandleRead, defaultCheckHandleWrite, defaultDoYouSupportAccess } from './lib/lib'

import { GenericFileOperationsHandler } from './lib/GenericFileOperations'
import { GenericFileHandler } from './lib/GenericFileHandler'
import { JSONWriteFilesBestEffortHandler } from './lib/json-write-file'
import { S3BucketClient } from './lib/S3BucketClient'
import { Readable } from 'node:stream'

export interface Content {
	/** This is set when the class-instance is only going to be used for PackageContainer access.*/
	onlyContainerAccess?: boolean
	filePath: string
}

type S3Options = Omit<Accessor.S3, 'type' | 'label' | 'allowRead' | 'allowWrite' | 'basePath' | 'networkId'>

/** Accessor handle for accessing files in a s3 bucket */
export class S3AccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 's3'
	private readonly content: Content
	private readonly workOptions: Expectation.WorkOptions.RemoveDelay & Expectation.WorkOptions.UseTemporaryFilePath
	private readonly accessor: AccessorOnPackage.S3

	public fileHandler: GenericFileOperationsHandler

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.S3>) {
		super({
			...arg,
			type: S3AccessorHandle.type,
		})
		this.accessor = arg.accessor
		this.content = arg.content ?? {}
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
		if (this.accessor.type !== Accessor.AccessType.S3) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `S3 Accessor type is not S3 ("${this.accessor.type}")!`,
				},
			}
		}

		if (!this.content.onlyContainerAccess) {
			if (!this.content.filePath) {
				return {
					success: false,
					knownReason: true,
					reason: {
						user: `path not set`,
						tech: `path not set`,
					},
				}
			}
		}

		return { success: true }
	}
	checkCompatibilityWithAccessor(
		otherAccessor: AccessorOnPackage.Any
	): AccessorHandlerCheckHandleCompatibilityResult {
		if (
			otherAccessor.type === Accessor.AccessType.S3 &&
			otherAccessor.region === this.accessor.region &&
			otherAccessor.bucketId === this.accessor.bucketId
		) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: 'Cannot use two S3 accessors of the same bucket instance',
					tech: `Cannot use two S3 accessors of the same bucket instance ("in region ${otherAccessor.region}")`,
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
		const s3 = await this.getS3Client()

		const response = await s3.fileExists(this.fullPath)

		if (response.exists) {
			return { success: true }
		} else {
			return { success: false, reason: response.reason, knownReason: response.knownReason }
		}
	}
	async tryPackageRead(): Promise<AccessorHandlerTryPackageReadResult> {
		const s3 = await this.getS3Client()

		const response = await s3.getFileInfo(this.fullPath)

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
	async getPackageActualVersion(): Promise<Expectation.Version.S3Resource> {
		const s3 = await this.getS3Client()

		const response = await s3.getFileInfo(this.fullPath)

		if (response.success) {
			return {
				type: Expectation.Version.Type.S3_RESOURCE,
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
		const s3 = await this.getS3Client()

		try {
			const abortController = new AbortController()
			const response = await s3.readFile(this.fullPath, abortController.signal)

			return {
				readStream: Readable.fromWeb(response),
				cancel: () => {
					try {
						abortController.abort()
					} catch (e: any) {
						this.worker.logger.error(
							`getPackageReadStream: Error when aborting S3 stream: ${
								e && 'message' in e ? e.message : JSON.stringify(e)
							}`
						)
					}
				},
			}
		} catch (e: any) {
			this.worker.logger.error(
				`getPackageReadStream: Error when downloading S3 stream: ${
					e && 'message' in e ? e.message : JSON.stringify(e)
				}`
			)

			throw e
		}
	}

	async putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		const s3 = await this.getS3Client()

		const fullPath = this.workOptions.useTemporaryFilePath ? this.temporaryFilePath : this.fullPath

		await s3.removeFileIfExists(fullPath)

		const abortController = new AbortController()

		const streamWrapper: PutPackageHandler = new PutPackageHandler(() => {
			abortController.abort()
		})

		const pResponse = s3.writeFile(fullPath, Readable.from(sourceStream), abortController)

		pResponse
			.then(() => {
				streamWrapper.emit('close')
			})
			.catch((err) => {
				const err2 = new Error(`S3 upload threw for path "${fullPath}": ${err}`)
				if (err instanceof Error) err2.stack += `Original stack:\n${err.stack}`
				streamWrapper.emit('error', err2)
			})

		return streamWrapper
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('S3.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		throw new Error('S3.putPackageInfo: Not supported')
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
			const s3 = await this.getS3Client()

			if (await s3.removeFileIfExists(this.fullPath)) {
				this.logOperation(`Finalize package: Remove file "${this.fullPath}"`)
			}

			await s3.renameFile(this.temporaryFilePath, this.fullPath)
			this.logOperation(`Finalize package: Rename file "${this.temporaryFilePath}" to "${this.fullPath}"`)
		}
	}

	// Note: We handle metadata by storing a metadata json-file to the side of the file.

	async fetchMetadata(): Promise<Metadata | undefined> {
		const s3 = await this.getS3Client()

		if (await this.fileExists(this.metadataPath)) {
			const stream = await s3.readFile(this.metadataPath)

			const text = await S3AccessorHandle.streamToString(stream)

			return JSON.parse(text)
		} else return undefined
	}

	private static async streamToString(stream: ReadableStream) {
		const reader = stream.getReader()
		const decoder = new TextDecoder('utf-8')
		let result = ''

		while (!decoder.fatal) {
			const { value, done } = await reader.read()
			if (done) break
			result += decoder.decode(value, { stream: true })
		}

		result += decoder.decode()
		return result
	}

	async updateMetadata(metadata: Metadata): Promise<void> {
		await this.writeFile(this.metadataPath, JSON.stringify(metadata))
	}
	async removeMetadata(): Promise<void> {
		const s3 = await this.getS3Client()

		await s3.removeFileIfExists(this.metadataPath)
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
					badReason = await this.fileHandler.cleanupOldFiles(options.cleanFileAge, S3AccessorHandle.basePath)
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of cronjobs are handled:
				assertNever(cronjob)
			}
		}

		if (!badReason) return { success: true }
		else return { success: false, knownReason: false, reason: badReason }
	}

	static basePath = '/'

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

	get s3Options(): S3Options {
		const accessKey = this.accessor.accessKey
		const secretAccessKey = this.accessor.secretAccessKey
		const bucketId = this.accessor.bucketId
		const region = this.accessor.region
		const s3PublicBaseUrl = this.accessor.s3PublicBaseUrl
		const endpoint = this.accessor.endpoint
		const forcePathStyle = this.accessor.forcePathStyle

		if (accessKey === undefined) throw new Error('S3AccessorHandle: accessKey is not set!')
		if (secretAccessKey === undefined) throw new Error('S3AccessorHandle: secretAccessKey is not set!')
		if (bucketId === undefined) throw new Error('S3AccessorHandle: bucketId is not set!')
		if (region === undefined) throw new Error('S3AccessorHandle: region is not set!')
		if (s3PublicBaseUrl === undefined) throw new Error('S3AccessorHandle: s3PublicBaseUrl is not set!')

		return {
			accessKey,
			secretAccessKey,
			bucketId,
			region,
			s3PublicBaseUrl,
			endpoint,
			forcePathStyle,
		}
	}

	private async getS3Client(): Promise<S3BucketClient> {
		let client = this.getS3ClientFromCache(
			this.s3Options.region,
			this.s3Options.accessKey,
			this.s3Options.secretAccessKey,
			this.s3Options.s3PublicBaseUrl,
			this.s3Options.endpoint,
			this.s3Options.forcePathStyle
		)

		if (!client) {
			client = this.createNewS3Client()

			this.cacheS3Client(
				client,
				this.s3Options.region,
				this.s3Options.accessKey,
				this.s3Options.secretAccessKey,
				this.s3Options.s3PublicBaseUrl,
				this.s3Options.endpoint,
				this.s3Options.forcePathStyle
			)
		}

		return client
	}

	private getS3ClientFromCache(
		region: string,
		accessKey: string,
		secretAccessKey: string,
		publicBaseUrl: string,
		endpoint?: string,
		forcePathStyle?: boolean
	): S3BucketClient | undefined {
		const accessorCache = this.worker.accessorCache as {
			[accessorType: string]: S3BucketClient | undefined
		}

		return accessorCache[
			S3AccessorHandle.getCacheKeyForS3Client(
				accessKey,
				secretAccessKey,
				region,
				publicBaseUrl,
				endpoint,
				forcePathStyle
			)
		]
	}

	private cacheS3Client(
		client: S3BucketClient,
		region: string,
		accessKey: string,
		secretAccessKey: string,
		publicBaseUrl: string,
		endpoint?: string,
		forcePathStyle?: boolean
	): void {
		const accessorCache = this.worker.accessorCache as {
			[accessorType: string]: S3BucketClient | undefined
		}

		accessorCache[
			S3AccessorHandle.getCacheKeyForS3Client(
				accessKey,
				secretAccessKey,
				region,
				publicBaseUrl,
				endpoint,
				forcePathStyle
			)
		] = client
	}

	static getCacheKeyForS3Client(
		accessKey: string,
		secretAccessKey: string,
		region: string,
		publicBaseUrl: string,
		endpoint?: string,
		forcePathStyle?: boolean
	): string {
		return JSON.stringify([accessKey, secretAccessKey, region, publicBaseUrl, endpoint, forcePathStyle])
	}

	private createNewS3Client(): S3BucketClient {
		return new S3BucketClient(
			this.s3Options.bucketId,
			this.s3Options.region,
			this.s3Options.accessKey,
			this.s3Options.secretAccessKey,
			this.s3Options.endpoint,
			this.s3Options.forcePathStyle
		)
	}

	async unlinkIfExists(fullPath: string): Promise<boolean> {
		const s3 = await this.getS3Client()
		return s3.unlinkIfExists(fullPath)
	}

	async fileExists(fullPath: string): Promise<boolean> {
		const s3 = await this.getS3Client()
		return (await s3.fileExists(fullPath)).exists
	}

	async readFile(fullPath: string): Promise<Buffer> {
		const s3 = await this.getS3Client()
		const stream = await s3.readFile(fullPath)

		return await S3AccessorHandle.readableStreamToBuffer(stream)
	}

	async readFileIfExists(fullPath: string): Promise<Buffer | undefined> {
		try {
			return await this.readFile(fullPath)
		} catch (e) {
			this.logOperation(`File ${fullPath} didn't exist or could not be read: ${e}`)
			return undefined
		}
	}

	static async readableStreamToBuffer(stream: ReadableStream): Promise<Buffer> {
		const reader = stream.getReader()
		const chunks = []

		while (!stream.locked) {
			const { value, done } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		return Buffer.concat(chunks.map((u8) => Buffer.from(u8)))
	}

	async writeFile(fullPath: string, content: Buffer | string): Promise<void> {
		const s3 = await this.getS3Client()

		await s3.writeFile(fullPath, content)
	}

	async listFilesInDir(fullPath: string): Promise<
		{
			name: string
			isDirectory: boolean
			lastModified: number | undefined
		}[]
	> {
		const s3 = await this.getS3Client()
		return await s3.listFilesInDir(fullPath)
	}
	async removeDirIfExists(fullPath: string): Promise<boolean> {
		const s3 = await this.getS3Client()
		return await s3.removeDirIfExists(fullPath)
	}
	async rename(from: string, to: string): Promise<void> {
		const s3 = await this.getS3Client()
		return await s3.renameFile(from, to)
	}

	get fullPath(): string {
		return this.getFullPath(this.filePath)
	}

	getFullPath(filePath: string): string {
		// Returns full path, beginning with '/'
		return filePath.replace(/\\/g, '/')
	}

	/** Full path to a temporary file */
	get temporaryFilePath(): string {
		return this.fullPath + '.pmtemp'
	}
	/** Full path to the metadata file */
	private get metadataPath() {
		return this.fullPath + '_metadata.json'
	}

	get filePath(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')
		const filePath = this._getFilePath()
		if (!filePath) throw new Error(`S3AccessorHandle: path not set!`)
		return filePath
	}

	private _getFilePath(): string | undefined {
		return this.accessor.filePath || this.content.filePath
	}

	/** Full path to the metadata file */
	private getMetadataPath(fullUrl: string) {
		return fullUrl + '_metadata.json'
	}

	getFullS3PublicUrl(): string {
		return this.accessor.s3PublicBaseUrl + this.fullPath
	}
}
