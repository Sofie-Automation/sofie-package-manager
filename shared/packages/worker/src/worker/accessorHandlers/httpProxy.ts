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
	rebaseUrl,
} from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import FormData from 'form-data'
import { MonitorInProgress } from '../lib/monitorInProgress'
import { fetchWithController, fetchWithTimeout } from './lib/fetch'
import { defaultCheckHandleRead, defaultCheckHandleWrite, defaultDoYouSupportAccess } from './lib/lib'
import { GenericFileOperationsHandler } from './lib/GenericFileOperations'
import { JSONWriteFilesBestEffortHandler } from './lib/json-write-file'
import { GenericFileHandler } from './lib/GenericFileHandler'
import { PassThrough } from 'stream'

// Feature flag to disable delayed removal for HTTP-Proxy accessor
// Due to issues with acquiring file lock for the json file...
const ENABLE_HTTP_PROXY_DELAY_REMOVAL = false

/** Accessor handle for accessing files in HTTP- */
export class HTTPProxyAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'http-proxy'
	private content: {
		/** This is set when the class-instance is only going to be used for PackageContainer access.*/
		onlyContainerAccess?: boolean
		filePath?: string
	}
	private workOptions: Expectation.WorkOptions.RemoveDelay
	private accessor: AccessorOnPackage.HTTPProxy

	public fileHandler: GenericFileOperationsHandler | undefined = undefined

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.HTTPProxy>) {
		super({
			...arg,
			type: HTTPProxyAccessorHandle.type,
		})
		this.accessor = arg.accessor
		this.content = arg.content ?? {}
		this.workOptions = arg.workOptions

		// Verify content data:
		if (!this.content.onlyContainerAccess) {
			if (!this._getFilePath())
				throw new Error('Bad input data: neither content.filePath nor accessor.url are set!')
		}

		if (this.workOptions.removeDelay && typeof this.workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')

		if (ENABLE_HTTP_PROXY_DELAY_REMOVAL) {
			const fileHandler: GenericFileHandler = {
				logOperation: this.logOperation.bind(this),
				unlinkIfExists: this.deletePackageIfExists.bind(this),
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
	}
	static doYouSupportAccess(worker: BaseWorker, accessor: AccessorOnPackage.Any): boolean {
		return defaultDoYouSupportAccess(worker, accessor)
	}
	get packageName(): string {
		return this.fullUrl
	}
	checkHandleBasic(): AccessorHandlerCheckHandleBasicResult {
		if (this.accessor.type !== Accessor.AccessType.HTTP_PROXY) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `HTTPProxy Accessor type is not HTTP_PROXY ("${this.accessor.type}")!`,
				},
			}
		}
		if (!this.accessor.baseUrl)
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Accessor baseUrl not set`,
					tech: `Accessor baseUrl not set`,
				},
			}
		if (!this.content.onlyContainerAccess) {
			if (!this.filePath)
				return {
					success: false,
					knownReason: true,
					reason: {
						user: `filePath not set`,
						tech: `filePath not set`,
					},
				}
		}
		return { success: true }
	}
	checkCompatibilityWithAccessor(): AccessorHandlerCheckHandleCompatibilityResult {
		return { success: true } // no special compatibility checks
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
		const header = await this.fetchHeader()

		if (this.isBadHTTPResponseCode(header.status)) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Got error code ${header.status} when trying to fetch package`,
					tech: `Error when requesting url "${this.fullUrl}": [${header.status}]: ${header.statusText}`,
				},
			}
		}
		return { success: true }
	}
	async tryPackageRead(): Promise<AccessorHandlerTryPackageReadResult> {
		// TODO: how to do this?
		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerCheckPackageContainerWriteAccessResult> {
		// todo: how to check this?
		return { success: true }
	}
	async getPackageActualVersion(): Promise<Expectation.Version.HTTPFile> {
		const header = await this.fetchHeader()

		return this.convertHeadersToVersion(header.headers)
	}
	async ensurePackageFulfilled(): Promise<void> {
		// N/A
		// await this.fileHandler.clearPackageRemoval(this.filePath)
	}
	async removePackage(reason: string): Promise<void> {
		if (ENABLE_HTTP_PROXY_DELAY_REMOVAL && this.fileHandler) {
			await this.fileHandler.handleRemovePackage(this.filePath, this.packageName, reason)
		} else {
			await this.deletePackageIfExists(this.fullUrl)
		}
	}
	async getPackageReadStream(): Promise<PackageReadStream> {
		const fetch = fetchWithController(this.fullUrl)
		const res = await fetch.response

		if (this.isBadHTTPResponseCode(res.status)) {
			throw new Error(
				`HTTP.getPackageReadStream: Bad response: [${res.status}]: ${res.statusText}, GET ${this.fullUrl}`
			)
		}

		return {
			readStream: res.body,
			cancel: () => {
				fetch.controller.abort()
			},
		}
	}
	async putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		// Create a PassThrough stream that can receive data while the async preparation-operations are run:
		const passThroughStream = new PassThrough({ allowHalfOpen: false })
		sourceStream.pipe(passThroughStream)

		if (ENABLE_HTTP_PROXY_DELAY_REMOVAL && this.fileHandler) {
			await this.fileHandler.clearPackageRemoval(this.filePath)
		}

		const formData = new FormData()
		formData.append('file', passThroughStream)

		const fetch = fetchWithController(this.fullUrl, {
			method: 'POST',
			body: formData,
			refreshStream: passThroughStream, // pass in the source stream to avoid the fetch-timeout to fire
		})
		const streamHandler: PutPackageHandler = new PutPackageHandler(() => {
			fetch.controller.abort()
		})

		fetch.response
			.then((result) => {
				if (this.isBadHTTPResponseCode(result.status)) {
					throw new Error(
						`Upload file: Bad response: [${result.status}]: ${result.statusText} POST "${this.fullUrl}"`
					)
				}
			})
			.then(() => {
				streamHandler.emit('close')
			})
			.catch((error) => {
				streamHandler.emit('error', error)
			})

		return streamHandler
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('HTTP.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		throw new Error('HTTP.putPackageInfo: Not supported')
	}
	async prepareForOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>
	): Promise<PackageOperation> {
		if (ENABLE_HTTP_PROXY_DELAY_REMOVAL && this.fileHandler) {
			await this.fileHandler.clearPackageRemoval(this.filePath)
		}
		return this.logWorkOperation(operationName, source, this.packageName)
	}
	async finalizePackage(operation: PackageOperation): Promise<void> {
		// do nothing
		operation.logDone()
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		return this.fetchJSON(this.getMetadataPath(this.fullUrl))
	}
	async updateMetadata(metadata: Metadata): Promise<void> {
		await this.storeJSON(this.getMetadataPath(this.fullUrl), metadata)
	}
	async removeMetadata(): Promise<void> {
		await this.deletePackageIfExists(this.getMetadataPath(this.fullUrl))
	}

	async runCronJob(packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerRunCronJobResult> {
		const badReason: Reason | null = null
		const cronjobs = Object.keys(packageContainerExp.cronjobs) as (keyof PackageContainerExpectation['cronjobs'])[]
		for (const cronjob of cronjobs) {
			if (cronjob === 'interval') {
				// ignore
			} else if (cronjob === 'cleanup') {
				// const options = packageContainerExp.cronjobs[cronjob]
				// Not supported, however the http-server has its own cleanup routine
				// badReason = await this.fileHandler.removeDuePackages()
				// if (!badReason && options?.cleanFileAge) {
				// 	// Not supported, however the http-server has its own cleanup routine
				// }
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
				// todo: implement monitors
				throw new Error('Not implemented yet')
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of monitors are handled:
				assertNever(monitorIdStr)
			}
		}

		return { success: true, monitors: resultingMonitors }
	}
	get fullUrl(): string {
		return this.getFullPath(this.filePath)
	}

	private get baseUrl(): string {
		if (!this.accessor.baseUrl) throw new Error(`HTTPAccessorHandle: accessor.baseUrl not set!`)
		return this.accessor.baseUrl
	}
	get filePath(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')
		const filePath = this._getFilePath()
		if (!filePath) throw new Error(`HTTPAccessorHandle: filePath not set!`)
		return filePath
	}
	private convertHeadersToVersion(headers: HTTPHeaders): Expectation.Version.HTTPFile {
		return {
			type: Expectation.Version.Type.HTTP_FILE,

			contentType: headers.contentType || '',
			contentLength: parseInt(headers.contentLength || '0', 10) || 0,
			modified: headers.lastModified ? new Date(headers.lastModified).getTime() : 0,
			etags: [], // headers.etags, // todo!
		}
	}
	private async fetchHeader() {
		const fetch = fetchWithController(this.fullUrl, {
			method: 'HEAD',
		})
		const res = await fetch.response

		res.body.on('error', () => {
			// Swallow the error. Since we're aborting the request, we're not interested in the body anyway.
		})

		const headers: HTTPHeaders = {
			contentType: res.headers.get('content-type'),
			contentLength: res.headers.get('content-length'),
			lastModified: res.headers.get('last-modified'),
			etags: res.headers.get('etag'),
		}

		return {
			status: res.status,
			statusText: res.statusText,
			headers: headers,
		}
	}
	/** Returns false if nothing was removed */
	private async deletePackageIfExists(url: string): Promise<boolean> {
		const result = await fetchWithTimeout(url, {
			method: 'DELETE',
		})
		if (result.status === 404) return false // that's ok
		if (this.isBadHTTPResponseCode(result.status)) {
			const text = await result.text()
			throw new Error(
				`deletePackageIfExists: Bad response: [${result.status}]: ${result.statusText}, DELETE ${url}, ${text}`
			)
		}
		return true
	}

	private async fetchJSON(url: string): Promise<any | undefined> {
		const result = await fetchWithTimeout(url)
		if (result.status === 404) return undefined
		if (this.isBadHTTPResponseCode(result.status)) {
			const text = await result.text()
			throw new Error(`fetchJSON: Bad response: [${result.status}]: ${result.statusText}, GET ${url}, ${text}`)
		}
		return result.json()
	}
	private async storeJSON(url: string, data: any): Promise<void> {
		const formData = new FormData()
		formData.append('text', JSON.stringify(data))
		const result = await fetchWithTimeout(url, {
			method: 'POST',
			body: formData,
		})
		if (this.isBadHTTPResponseCode(result.status)) {
			const text = await result.text()
			throw new Error(`storeJSON: Bad response: [${result.status}]: ${result.statusText}, POST ${url}, ${text}`)
		}
	}
	/** Full path to the metadata file */
	private getMetadataPath(fullUrl: string) {
		return fullUrl + '_metadata.json'
	}
	private _getFilePath(): string | undefined {
		return this.accessor.url || this.content.filePath
	}
	private isBadHTTPResponseCode(code: number) {
		return code >= 400
	}

	private getFullPath(filePath: string): string {
		return rebaseUrl(this.baseUrl, filePath)
	}

	private async fileExists(fullPath: string): Promise<boolean> {
		const header = await this.fetchHeader()

		if (header.status === 200) return true
		else if (header.status === 404) return false
		else
			throw new Error(
				`Error when checking if file exists: [${header.status}]: ${header.statusText}, at ${fullPath}`
			)
	}
	private async readFile(fullPath: string): Promise<Buffer> {
		const result = await fetchWithTimeout(fullPath)
		if (this.isBadHTTPResponseCode(result.status)) {
			const text = await result.text()
			throw new Error(
				`getPackagesToRemove: Bad response: [${result.status}]: ${result.statusText}, GET ${fullPath}, ${text}`
			)
		}
		return result.buffer()
	}
	private async readFileIfExists(fullPath: string): Promise<Buffer | undefined> {
		try {
			return await this.readFile(fullPath)
		} catch (e) {
			if (e instanceof Error && e.message.includes('[404]')) return undefined // not found
			throw e // some other error
		}
	}
	private async writeFile(fullPath: string, content: Buffer): Promise<void> {
		const formData = new FormData()
		formData.append('myFile', content)
		const result = await fetchWithTimeout(fullPath, {
			method: 'POST',
			body: formData,
		})
		if (this.isBadHTTPResponseCode(result.status)) {
			const text = await result.text()
			throw new Error(
				`writeFile: Bad response: [${result.status}]: ${result.statusText}, POST ${fullPath}, ${text}`
			)
		}
	}
	private async listFilesInDir(fullPath: string): Promise<
		{
			name: string
			isDirectory: boolean
			lastModified: number | undefined
		}[]
	> {
		// http-server doesn't support listing inner directories, so we'll just list the root and filter:

		const result = await fetchWithTimeout(this.getFullPath('packages'), {
			method: 'GET',
		})
		if (this.isBadHTTPResponseCode(result.status)) {
			const text = await result.text()
			throw new Error(
				`listFilesInDir: Bad response: [${result.status}]: ${result.statusText}, GET /packages ${text}`
			)
		}

		// from http-server:
		type PackageInfo = {
			path: string
			size: string
			modified: string
		}
		const json = (await result.json()) as { packages: PackageInfo[] }

		const files: {
			name: string
			isDirectory: boolean
			lastModified: number | undefined
		}[] = []

		// Clever trick: We can omit directories, but return ALL files in the directory, including subdirectories!.
		for (const pkg of json.packages) {
			if (pkg.path.startsWith(fullPath)) {
				const name = pkg.path.slice(fullPath.length)

				files.push({
					name,
					isDirectory: false,
					lastModified: pkg.modified ? new Date(pkg.modified).getTime() : undefined,
				})
			}
		}
		return files
	}
	private async removeDirIfExists(_fullPath: string): Promise<boolean> {
		// not supported
		return false
	}
	private async rename(_from: string, _to: string): Promise<void> {
		// not supported
		throw new Error('HTTPProxyAccessorHandle.rename: Not supported')
	}
}
interface HTTPHeaders {
	contentType: string | null
	contentLength: string | null
	lastModified: string | null
	etags: string | null
}
