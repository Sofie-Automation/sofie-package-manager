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
	MonitorId,
	rebaseUrl,
} from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import { fetchWithController } from './lib/fetch'
import { MonitorInProgress } from '../lib/monitorInProgress'
import { defaultCheckHandleRead, defaultCheckHandleWrite, defaultDoYouSupportAccess } from './lib/lib'

/**
 * Accessor handle for accessing files at an HTTP endpoint
 * Note: This class supports read-only access. For write, use HTTPProxy.
 */
export class HTTPAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'http'
	private content: {
		/** This is set when the class-instance is only going to be used for PackageContainer access.*/
		onlyContainerAccess?: boolean
		filePath?: string
		path?: string
	}
	// private workOptions: unknown // no workOptions supported
	private accessor: AccessorOnPackage.HTTP

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.HTTP>) {
		super({
			...arg,
			type: HTTPAccessorHandle.type,
		})
		this.accessor = arg.accessor
		this.content = arg.content
		// this.workOptions = arg.workOptions

		// Verify content data:
		if (!this.content.onlyContainerAccess) {
			if (!this._getFilePath()) throw new Error('Bad input data: neither content.path nor accessor.url are set!')
		}
	}
	static doYouSupportAccess(worker: BaseWorker, accessor: AccessorOnPackage.Any): boolean {
		return defaultDoYouSupportAccess(worker, accessor)
	}
	get packageName(): string {
		return this.path
	}
	checkHandleBasic(): AccessorHandlerCheckHandleBasicResult {
		if (this.accessor.type !== Accessor.AccessType.HTTP) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `HTTP Accessor type is not HTTP ("${this.accessor.type}")!`,
				},
			}
		}
		// Note: For the HTTP-accessor, we allow this.accessor.baseUrl to be empty/falsy
		// (which means that the content path needs to be a full URL)

		if (!this.content.onlyContainerAccess) {
			if (!this.path)
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
		// TODO: Do a HEAD request?
		// 204 or 404 is "not found"
		// Access-Control-Allow-Methods should contain GET
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
		// Nothing, HTTP is read only
	}
	async removePackage(_reason: string): Promise<void> {
		await this.removeMetadata()

		// Nothing to remove, HTTP is read-only
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
	async putPackageStream(_sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		throw new Error('HTTP.putPackageStream: Not supported')
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
		return this.logWorkOperation(operationName, source, this.packageName)
	}
	async finalizePackage(operation: PackageOperation): Promise<void> {
		// do nothing
		operation.logDone()
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		return undefined
	}
	async updateMetadata(_metadata: Metadata): Promise<void> {
		// Not supported
	}
	async removeMetadata(): Promise<void> {
		// Not supported
	}

	async runCronJob(_packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerRunCronJobResult> {
		return {
			success: true,
		} // not applicable, since the HTTP Accessor is readonly
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
		return rebaseUrl(this.baseUrl, this.path)
	}

	private get baseUrl(): string {
		return this.accessor.baseUrl ?? ''
	}
	get path(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')
		const filePath = this._getFilePath()
		if (!filePath) throw new Error(`HTTPAccessorHandle: path not set!`)
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
		const ttl = this.accessor.isImmutable
			? 1000 * 60 * 60 * 24 // 1 day
			: 1000 // a second

		if (this.accessor.useGETinsteadOfHEAD) {
			// The source does NOT support HEAD requests, send a GET instead and abort the response:
			return await this.worker.cacheData(
				this.type,
				`GET ${this.fullUrl}`,
				async () => {
					const r = fetchWithController(this.fullUrl, {
						method: 'GET',
					})
					const response = await r.response
					response.body.on('error', () => {
						// Swallow the error. Since we're aborting the request, we're not interested in the body anyway.
					})

					const headers: HTTPHeaders = {
						contentType: response.headers.get('content-type'),
						contentLength: response.headers.get('content-length'),
						lastModified: response.headers.get('last-modified'),
						etags: response.headers.get('etag'),
					}
					// We're not interested in the actual body, so abort the request:
					r.controller.abort()
					return {
						headers,
						status: response.status,
						statusText: response.statusText,
					}
				},
				ttl
			)
		} else {
			return await this.worker.cacheData(
				this.type,
				`HEAD ${this.fullUrl}`,
				async () => {
					const r = fetchWithController(this.fullUrl, {
						method: 'HEAD',
					})
					const response = await r.response
					response.body.on('error', (e) => {
						this.worker.logger.warn(`fetchHeader: Error ${e}`)
					})

					const headers: HTTPHeaders = {
						contentType: response.headers.get('content-type'),
						contentLength: response.headers.get('content-length'),
						lastModified: response.headers.get('last-modified'),
						etags: response.headers.get('etag'),
					}
					return {
						headers,
						status: response.status,
						statusText: response.statusText,
					}
				},
				ttl
			)
		}
	}

	private _getFilePath(): string | undefined {
		return this.accessor.url || this.content.filePath || this.content.path
	}
	private isBadHTTPResponseCode(code: number) {
		return code >= 400
	}
}
interface HTTPHeaders {
	contentType: string | null
	contentLength: string | null
	lastModified: string | null
	etags: string | null
}
