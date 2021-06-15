import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { ClipSearchQuery, QuantelGateway } from 'tv-automation-quantel-gateway-client'
import {
	GenericAccessorHandle,
	PackageReadInfo,
	PackageReadInfoBaseType,
	PackageReadInfoQuantelClip,
	PutPackageHandler,
	AccessorHandlerResult,
} from './genericHandle'
import { Expectation, literal, Reason } from '@shared/api'
import { GenericWorker } from '../worker'
import { ClipData, ClipDataSummary, ServerInfo } from 'tv-automation-quantel-gateway-client/dist/quantelTypes'

/** The minimum amount of frames where a clip is minimumly playable */
const MINIMUM_FRAMES = 10

/** Accessor handle for handling clips in a Quantel system */
export class QuantelAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'quantel'
	private content: {
		onlyContainerAccess?: boolean
		guid?: string
		title?: string
	}
	// @ts-expect-error unused variable
	private workOptions: any
	constructor(
		worker: GenericWorker,
		accessorId: string,
		private accessor: AccessorOnPackage.Quantel,
		content: any, // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
		workOptions: any // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
	) {
		super(worker, accessorId, accessor, content, QuantelAccessorHandle.type)

		// Verify content data:
		if (!content.onlyContainerAccess) {
			if (content.guid && typeof content.guid !== 'string')
				throw new Error('Bad input data: content.guid must be a string!')
			if (content.title && typeof content.title !== 'string')
				throw new Error('Bad input data: content.title must be a string!')
		}
		this.content = content

		this.workOptions = workOptions
	}
	static doYouSupportAccess(worker: GenericWorker, accessor0: AccessorOnPackage.Any): boolean {
		const accessor = accessor0 as AccessorOnPackage.Quantel
		return !accessor.networkId || worker.location.localNetworkIds.includes(accessor.networkId)
	}
	checkHandleRead(): AccessorHandlerResult {
		if (!this.accessor.allowRead) {
			return { success: false, reason: { user: `Not allowed to read`, tech: `Not allowed to read` } }
		}
		return this.checkAccessor()
	}
	checkHandleWrite(): AccessorHandlerResult {
		if (!this.accessor.allowWrite) {
			return { success: false, reason: { user: `Not allowed to write`, tech: `Not allowed to write` } }
		}
		if (!this.accessor.serverId) {
			return {
				success: false,
				reason: {
					user: `serverId not set, this is required for a target`,
					tech: `serverId not set (required for target)`,
				},
			}
		}
		return this.checkAccessor()
	}
	private checkAccessor(): AccessorHandlerResult {
		if (this.accessor.type !== Accessor.AccessType.QUANTEL) {
			return {
				success: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `Quantel Accessor type is not QUANTEL ("${this.accessor.type}")!`,
				},
			}
		}
		if (!this.accessor.quantelGatewayUrl)
			return {
				success: false,
				reason: { user: `Quantel GatewayUrl not set in settings`, tech: `Accessor quantelGatewayUrl not set` },
			}
		if (!this.accessor.ISAUrls)
			return { success: false, reason: { user: `ISAUrls not set in settings`, tech: `Accessor ISAUrls not set` } }
		if (!this.accessor.ISAUrls.length)
			return {
				success: false,
				reason: { user: `ISAUrls is empty in settings`, tech: `Accessor ISAUrls is empty` },
			}
		if (!this.content.onlyContainerAccess) {
			if (!this.content.guid && this.content.title)
				return {
					success: false,
					reason: {
						user: `Neither guid or title are set on the package (at least one should be)`,
						tech: `Neither guid or title are set (at least one should be)`,
					},
				}
		}

		return { success: true }
	}
	async checkPackageReadAccess(): Promise<AccessorHandlerResult> {
		const quantel = await this.getQuantelGateway()

		// Search for a clip that match:
		const clipSummary = await this.searchForLatestClip(quantel)

		if (clipSummary) {
			// There is at least one clip that matches the query
			return { success: true }
		} else {
			return {
				success: false,
				reason: {
					user: `Quantel clip "${this.content.guid || this.content.title}" not found`,
					tech: `Quantel clip "${this.content.guid || this.content.title}" not found`,
				},
			}
		}
	}
	async tryPackageRead(): Promise<AccessorHandlerResult> {
		const quantel = await this.getQuantelGateway()

		const clipSummary = await this.searchForLatestClip(quantel)

		if (!clipSummary) return { success: false, reason: { user: `No clip found`, tech: `No clip found` } }

		if (!parseInt(clipSummary.Frames, 10)) {
			return {
				success: false,
				reason: {
					user: `The clip has no frames`,
					tech: `Clip "${clipSummary.ClipGUID}" has no frames`,
				},
			}
		}
		if (parseInt(clipSummary.Frames, 10) < MINIMUM_FRAMES) {
			// Check that it is meaningfully playable
			return {
				success: false,
				reason: {
					user: `The clip hasn't received enough frames`,
					tech: `Clip "${clipSummary.ClipGUID}" hasn't received enough frames (${clipSummary.Frames})`,
				},
			}
		}
		// 5/5/21: Removed check for completed - OA tests shoes it does nothing for placeholders / Richard
		// if (!clipSummary.Completed || !clipSummary.Completed.length) {
		// Note from Richard: Completed might not necessarily mean that it's completed on the right server
		// 	return `Clip "${clipSummary.ClipGUID}" is not completed`
		// }

		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerResult> {
		const quantel = await this.getQuantelGateway()

		const server = await quantel.getServer()

		if (!server) throw new Error(`Server ${this.accessor.serverId} not found!`)

		if (!server.pools) throw new Error(`Server ${this.accessor.serverId} has no disk pools!`)
		if (!server.pools.length) throw new Error(`Server ${this.accessor.serverId} has no disk pools!`)
		if (server.down) throw new Error(`Server ${this.accessor.serverId} is down!`)

		return { success: true }
	}
	async getPackageActualVersion(): Promise<Expectation.Version.QuantelClip> {
		const quantel = await this.getQuantelGateway()

		const clipSummary = await this.searchForLatestClip(quantel)

		if (clipSummary) {
			return this.convertClipSummaryToVersion(clipSummary)
		} else throw new Error(`Clip not found`)
	}
	async removePackage(): Promise<void> {
		await this.removeMetadata()
		// We don't really do this, instead we let the quantel management delete old clip.
		// Perhaps in the future, we could have an opt-in feature to remove clips?
		return undefined // that's ok
	}

	async getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }> {
		throw new Error('Quantel.getPackageReadStream: Not supported')
	}
	async putPackageStream(_sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		throw new Error('Quantel.putPackageStream: Not supported')
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		const quantel = await this.getQuantelGateway()

		const clipSummary = await this.searchForLatestClip(quantel)

		if (clipSummary) {
			return {
				readInfo: literal<PackageReadInfoQuantelClip>({
					type: PackageReadInfoBaseType.QUANTEL_CLIP,
					version: this.convertClipSummaryToVersion(clipSummary),
					clipId: clipSummary.ClipID,
				}),
				cancel: () => {
					// Nothing
				},
			}
		} else throw new Error(`Clip not found`)
	}
	async putPackageInfo(readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		if (readInfo.type !== PackageReadInfoBaseType.QUANTEL_CLIP) {
			throw new Error(`Quantel.putPackageInfo: unsupported readInfo`)
		}

		const quantel = await this.getQuantelGateway()

		const streamHandler: PutPackageHandler = new PutPackageHandler(() => {
			// Can't be aborted, do nothing
		})

		// Wrapping, to enable the consumer to listen to the streamHandler.emit('close') event.
		setImmediate(() => {
			;(async () => {
				const server = await quantel.getServer()

				if (!server) throw new Error(`Server ${this.accessor.serverId} not found!`)

				if (!server.pools) throw new Error(`Server ${this.accessor.serverId} has no disk pools!`)
				if (!server.pools.length) throw new Error(`Server ${this.accessor.serverId} has no disk pools!`)

				// Verify that the clip is of the right version:
				const clipData = await quantel.getClip(readInfo.clipId)
				if (!clipData) throw new Error(`Clip id ${readInfo.clipId} not found`)
				if (clipData.Created !== readInfo.version.created)
					throw new Error(
						`Clip id ${readInfo.clipId} property "Created" doesn't match (${clipData.Created} vs ${readInfo.version.created})`
					)
				const cloneId = clipData.CloneId || clipData.ClipID

				if (cloneId !== readInfo.version.cloneId) {
					throw new Error(
						`Clip id ${readInfo.clipId} property "CloneId" doesn't match (${cloneId} vs ${readInfo.version.cloneId})`
					)
				}

				let copyCreated = false
				// Try to copy onto one of the server pools, and stop trying on first success.
				let copyError: any = null
				for (const pool of server.pools) {
					try {
						// Note: Intra-zone copy only
						await quantel.copyClip(undefined, readInfo.clipId, pool, 8, true)

						copyCreated = true
					} catch (err) {
						copyError = err
					}
					if (copyCreated) break //
				}
				if (!copyCreated) {
					if (copyError) {
						throw copyError
					} else {
						throw new Error(`Unknown error in Quantel.putPackageInfo`)
					}
				}
			})()
				.then(() => {
					streamHandler.emit('close')
				})
				.catch((error) => {
					streamHandler.emit('error', error)
				})
		})

		return streamHandler
	}
	async finalizePackage(): Promise<void> {
		// do nothing
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		throw new Error('Quantel.fetchMetadata: Not supported')
	}
	async updateMetadata(_metadata: Metadata): Promise<void> {
		// Not supported, do nothing
	}
	async removeMetadata(): Promise<void> {
		// Not supported, do nothing
	}
	async runCronJob(): Promise<AccessorHandlerResult> {
		return {
			success: false,
			reason: { user: `There is an internal issue in Package Manager`, tech: 'runCronJob not supported' },
		} // not applicable
	}
	async setupPackageContainerMonitors(): Promise<AccessorHandlerResult> {
		return {
			success: false,
			reason: {
				user: `There is an internal issue in Package Manager`,
				tech: 'setupPackageContainerMonitors, not supported',
			},
		} // not applicable
	}
	async disposePackageContainerMonitors(): Promise<AccessorHandlerResult> {
		return {
			success: false,
			reason: {
				user: `There is an internal issue in Package Manager`,
				tech: 'disposePackageContainerMonitors, not supported',
			},
		} // not applicable
	}

	async getClip(): Promise<ClipDataSummary | undefined> {
		const quantel = await this.getQuantelGateway()
		return this.searchForLatestClip(quantel)
	}
	async getClipDetails(clipId: number): Promise<ClipData | null> {
		const quantel = await this.getQuantelGateway()
		return quantel.getClip(clipId)
	}

	get transformerURL(): string | undefined {
		return this.accessor.transformerURL
	}
	async getTransformerStreamURL(): Promise<
		{ success: true; baseURL: string; url: string; fullURL: string } | { success: false; reason: Reason }
	> {
		if (!this.accessor.transformerURL)
			return {
				success: false,
				reason: {
					user: `transformerURL is not set in settings`,
					tech: `transformerURL not set`,
				},
			}

		const clip = await this.getClip()
		if (clip) {
			const baseURL = this.accessor.transformerURL
			const url = `/quantel/homezone/clips/streams/${clip.ClipID}/stream.mpd`
			return {
				success: true,
				baseURL,
				url,
				fullURL: [
					baseURL.replace(/\/$/, ''), // trim trailing slash
					url.replace(/^\//, ''), // trim leading slash
				].join('/'),
			}
		} else {
			return {
				success: false,
				reason: {
					user: `no clip found`,
					tech: `no clip found`,
				},
			}
		}
	}

	private convertClipSummaryToVersion(clipSummary: ClipDataSummary): Expectation.Version.QuantelClip {
		return {
			type: Expectation.Version.Type.QUANTEL_CLIP,
			cloneId: clipSummary.CloneId || clipSummary.ClipID,
			created: clipSummary.Created,
			frames: parseInt(clipSummary.Frames, 10) || 0,
		}
	}
	private async getQuantelGateway(): Promise<QuantelGateway> {
		/** Persistant store for Quantel gatews */
		const cacheGateways = this.ensureCache<{ [id: string]: QuantelGateway }>('gateways', {})

		// These errors are just for types. User-facing checks are done in this.checkAccessor()
		if (!this.accessor.quantelGatewayUrl) throw new Error('accessor.quantelGatewayUrl is not set')
		if (!this.accessor.ISAUrls) throw new Error('accessor.ISAUrls is not set')
		if (!this.accessor.ISAUrls.length) throw new Error('accessor.ISAUrls array is empty')

		const id = `${this.accessor.quantelGatewayUrl}`

		let gateway: QuantelGateway = cacheGateways[id]

		if (!gateway) {
			gateway = new QuantelGateway()
			await gateway.init(
				this.accessor.quantelGatewayUrl,
				this.accessor.ISAUrls,
				this.accessor.zoneId,
				this.accessor.serverId
			)

			gateway.on('error', (e) => this.worker.logger.error(`Quantel.QuantelGateway`, e))

			cacheGateways[id] = gateway
		}

		// Verify that the cached gateway matches what we want:
		// The reason for this is that a Quantel gateway is pointed at an ISA-setup on startup,
		// and shouldn't be changed without restarting aftewards.
		// So if you want to have multiple ISA:s, you should spin up multiple Quantel-gateways.
		if (this.accessor.quantelGatewayUrl !== gateway.gatewayUrl)
			throw new Error(
				`Cached QuantelGateway.quantelGatewayUrl doesnt match accessor ("${this.accessor.quantelGatewayUrl}" vs "${gateway.gatewayUrl}")`
			)
		if (this.accessor.ISAUrls.join(',') !== gateway.ISAUrls.join(','))
			throw new Error(
				`Cached QuantelGateway.ISAUrls doesn't match accessor ("${this.accessor.ISAUrls.join(
					','
				)}" vs "${gateway.ISAUrls.join(',')}")`
			)

		return gateway
	}
	/**
	 * Returns the clip to use as source
	 */
	private async searchForLatestClip(quantel: QuantelGateway): Promise<ClipDataSummary | undefined> {
		return (await this.searchForClips(quantel))[0]
	}
	/**
	 * Returns a list of all clips that match the guid or title.
	 * Sorted in the order of Created (latest first)
	 */
	private async searchForClips(quantel: QuantelGateway): Promise<ClipDataSummary[]> {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')

		let searchQuery: ClipSearchQuery = {}
		if (this.content.guid) {
			searchQuery = {
				ClipGUID: `"${this.content.guid}"`,
			}
		} else if (this.content.title) {
			searchQuery = {
				Title: `"${this.content.title}"`,
			}
		} else throw new Error(`Neither guid nor title set for Quantel clip`)

		let server: ServerInfo | null = null
		if (this.accessor.serverId) server = await quantel.getServer()

		return (await quantel.searchClip(searchQuery))
			.filter((clipData) => {
				return (
					typeof clipData.PoolID === 'number' &&
					(!server || (server.pools || []).indexOf(clipData.PoolID) !== -1) // If present in any of the pools of the server
				)
			})
			.sort(
				(
					a,
					b // Sort Created dates into reverse order
				) => new Date(b.Created).getTime() - new Date(a.Created).getTime()
			)
	}
}
