import {
	GenericAccessorHandle,
	PackageReadInfo,
	PackageReadStream,
	PutPackageHandler,
	SetupPackageContainerMonitorsResult,
	AccessorHandlerCheckHandleReadResult,
	AccessorHandlerCheckHandleWriteResult,
	AccessorHandlerCheckPackageContainerWriteAccessResult,
	AccessorHandlerCheckPackageReadAccessResult,
	AccessorHandlerTryPackageReadResult,
	AccessorHandlerRunCronJobResult,
	PackageOperation,
	AccessorHandlerCheckHandleBasicResult,
	AccessorConstructorProps,
	AccessorHandlerCheckHandleCompatibilityResult,
} from './genericHandle'
import { Expectation, Accessor, AccessorOnPackage } from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import { UniversalVersion } from '../workers/genericWorker/lib/lib'
import { defaultCheckHandleRead, defaultCheckHandleWrite, defaultDoYouSupportAccess } from './lib/lib'
import {
	assertNever,
	KairosConnection,
	MediaObject,
	MediaRamRecRef,
	MediaStatus,
	MediaStillRef,
	refToPath,
	// eslint-disable-next-line node/no-missing-import
} from 'kairos-connection'

export interface Content {
	/** This is set when the class-instance is only going to be used for PackageContainer access.*/
	onlyContainerAccess?: boolean
	ref?: MediaRamRecRef | MediaStillRef
}

/** Accessor handle for accessing Clips on a Kairos */
export class KairosClipAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'kairos_clip'
	private content: Content
	private accessor: AccessorOnPackage.KairosClip

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.KairosClip>) {
		super({
			...arg,
			type: KairosClipAccessorHandle.type,
		})

		this.accessor = arg.accessor
		this.content = arg.content ?? {}

		// Verify content data:
		if (!this.content.onlyContainerAccess) {
			if (!this.ref) throw new Error('Bad input data: ref is falsy!') // this should never throw, as this.ref would throw first
		}
	}
	static doYouSupportAccess(worker: BaseWorker, accessor: AccessorOnPackage.Any): boolean {
		return defaultDoYouSupportAccess(worker, accessor)
	}
	get ref(): MediaRamRecRef | MediaStillRef {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')

		const ref = this.accessor.ref || this.content.ref
		if (!ref) throw new Error(`Bad input data: neither content.ref nor accessor.ref are set!`)

		return ref
	}
	get packageName(): string {
		return refToPath(this.ref)
	}
	private async getKairosConnection(): Promise<KairosConnection> {
		if (!this.worker.accessorCache['kairos-connection']) {
			if (!this.accessor.host) {
				throw new Error('Bad input data: accessor.host not set!')
			}

			const kairos = new KairosConnection({
				host: this.accessor.host,
				port: this.accessor.port,
				autoConnect: true,
			})
			this.worker.accessorCache['kairos-connection'] = kairos

			await new Promise<void>((resolve, reject) => {
				kairos.on('connect', resolve)
				setTimeout(() => reject(new Error('Timeout when connecting to Kairos')), 5000)
			})
		}
		return this.worker.accessorCache['kairos-connection'] as KairosConnection
	}
	checkHandleBasic(): AccessorHandlerCheckHandleBasicResult {
		if (this.accessor.type !== Accessor.AccessType.KAIROS_CLIP) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `Accessor type is not kairos_clip: "${this.accessor.type}"!`,
				},
			}
		}
		if (!this.accessor.host) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Missing host in configuration`,
					tech: `Accessor host not set`,
				},
			}
		}
		if (!this.accessor.ref && !this.content.ref) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Missing reference in configuration`,
					tech: `Neither Accessor ref nor content ref are set`,
				},
			}
		}
		// Just an additional check to see that this.ref works:
		if (!this.ref) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Internal error (ref is falsy)`,
					tech: `Internal error: ref not set`,
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
		// Check if the package exists:
		const kairos = await this.getKairosConnection()
		const ref = this.ref

		// Check that the clip exists:
		let media: MediaObject | undefined = undefined
		if (ref.realm === 'media-ramrec') {
			media = await kairos.getMediaRamRec(ref)
		} else if (ref.realm === 'media-still') {
			media = await kairos.getMediaStill(ref)
		} else {
			assertNever(ref)
			throw new Error('Unsupported ref')
		}

		if (!media) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `${refToPath(ref)} not found on the Kairos`,
					tech: `${refToPath(ref)} not found on the Kairos`,
				},
			}
		}

		return { success: true }
	}
	async tryPackageRead(): Promise<AccessorHandlerTryPackageReadResult> {
		// Not much we can check here

		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerCheckPackageContainerWriteAccessResult> {
		// Not much we can check here
		return { success: true }
	}
	async getPackageActualVersion(): Promise<Expectation.Version.Unspecified> {
		// We don't have any information about the clip on the Kairos..
		return {
			type: Expectation.Version.Type.UNSPECIFIED,
		}
	}
	async ensurePackageFulfilled(): Promise<void> {
		// Nothing
	}
	async removePackage(_reason: string): Promise<void> {
		// Nothing
	}
	async getPackageReadStream(): Promise<PackageReadStream> {
		throw new Error('KairosClip.getPackageReadStream: Not supported')
	}
	async putPackageStream(_sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		throw new Error('KairosClip.putPackageStream: Not supported')
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('KairosClip.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		throw new Error('KairosClip.putPackageInfo: Not supported')
	}
	async prepareForOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>
	): Promise<PackageOperation> {
		// do nothing
		return this.logWorkOperation(operationName, source, this.packageName)
	}
	async finalizePackage(operation: PackageOperation): Promise<void> {
		// do nothing
		operation.logDone()
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		return {
			fileSize: { name: 'fileSize', value: undefined, omit: true },
			modified: { name: 'modified', value: undefined, omit: true },
			etags: { name: 'etags', value: undefined, omit: true },
			contentType: { name: 'contentType', value: undefined, omit: true },
		} as UniversalVersion as any as Metadata
	}
	async updateMetadata(_metadata: Metadata): Promise<void> {
		// Not supported
	}
	async removeMetadata(): Promise<void> {
		// Not supported
	}
	async runCronJob(): Promise<AccessorHandlerRunCronJobResult> {
		return {
			success: true,
		} // not applicable
	}
	async setupPackageContainerMonitors(): Promise<SetupPackageContainerMonitorsResult> {
		return {
			success: false,
			knownReason: false,
			reason: {
				user: `There is an internal issue in Package Manager`,
				tech: 'setupPackageContainerMonitors, not supported',
			},
		} // not applicable
	}

	/** Returns the progress of loading into RAM (number, 0-1)  */
	async getMediaStatus(): Promise<MediaObject | undefined> {
		const ref = this.ref

		const kairos = await this.getKairosConnection()

		if (ref.realm === 'media-ramrec') {
			return kairos.getMediaRamRec(ref)
		} else if (ref.realm === 'media-still') {
			return kairos.getMediaStill(ref)
		} else {
			assertNever(ref)
			throw new Error('Unsupported ref')
		}
	}
	/** Loads the ref into RAM */
	async uploadToRAM(): Promise<void> {
		const ref = this.ref
		this.logOperation(`Load "${refToPath(ref)}" into RAM`)

		const kairos = await this.getKairosConnection()

		if (ref.realm === 'media-ramrec') {
			const ramrec = await kairos.getMediaRamRec(ref)
			if (!ramrec) throw new Error(`MediaRamRec "${refToPath(ref)}" not found on Kairos`)

			if (ramrec.status === MediaStatus.LOAD && ramrec.loadProgress === 1) return // already loaded

			await kairos.updateMediaRamRec(ref, {
				status: MediaStatus.LOAD,
			})
		} else if (ref.realm === 'media-still') {
			const still = await kairos.getMediaStill(ref)
			if (!still) throw new Error(`MediaStill "${refToPath(ref)}" not found on Kairos`)

			if (still.status === MediaStatus.LOAD && still.loadProgress === 1) return // already loaded

			await kairos.updateMediaStill(ref, {
				status: MediaStatus.LOAD,
			})
		} else {
			assertNever(ref)
			throw new Error('Unsupported ref')
		}
	}
	async unloadFromRAM(_reason: string): Promise<void> {
		const ref = this.ref
		this.logOperation(`Unload "${refToPath(ref)}" from RAM`)

		const kairos = await this.getKairosConnection()

		if (ref.realm === 'media-ramrec') {
			await kairos.updateMediaRamRec(ref, {
				status: 0,
			})
		} else if (ref.realm === 'media-still') {
			await kairos.updateMediaStill(ref, {
				status: 0,
			})
		} else {
			assertNever(ref)
			throw new Error('Unsupported ref')
		}
	}
}
