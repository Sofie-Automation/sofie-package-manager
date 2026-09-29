import cors from '@koa/cors'
import Router from '@koa/router'
import { LoggerInstance, QuantelHTTPTransformerProxyConfig, stringifyError } from '@sofie-package-manager/api'
import Koa from 'koa'
import range from 'koa-range'
import ratelimit from 'koa-ratelimit'
import { parseStringPromise as xmlParser } from 'xml2js'

export class QuantelHTTPTransformerProxy {
	private app = new Koa()
	private router = new Router()
	private transformerURL: string | undefined = undefined
	private smoothStream = false

	private logger: LoggerInstance
	constructor(
		logger: LoggerInstance,
		private config: QuantelHTTPTransformerProxyConfig
	) {
		this.logger = logger.category('QuantelHTTPTransformerProxy')
		if (this.config.quantelHTTPTransformerProxy.transformerURL) {
			this.transformerURL = this.config.quantelHTTPTransformerProxy.transformerURL
		}
		if (this.transformerURL !== undefined) {
			while (this.transformerURL.endsWith('/')) {
				this.transformerURL = this.transformerURL.slice(0, -1)
			}
		}
		this.smoothStream = false // this.config.quantelHTTPTransformerProxy.streamType === QuantelStreamType.SMOOTH_STREAM
		this.app.on('error', (err) => this.logger.warn(`QuantelHTTPTransformerProxy Error: ${stringifyError(err)}`))
		this.app.use(range)

		this.app.use(
			cors({
				origin: '*',
			})
		)

		// Apply a rate limit, to avoid overloading the http-transformer server.
		const RATE_LIMIT_DURATION = config.quantelHTTPTransformerProxy.rateLimitDuration ?? 10 * 1000 // ms
		const RATE_LIMIT_MAX = config.quantelHTTPTransformerProxy.rateLimitMax ?? 10
		const db = new Map()
		this.app.use(
			ratelimit({
				driver: 'memory',
				db: db,
				duration: RATE_LIMIT_DURATION,
				max: RATE_LIMIT_MAX,
				errorMessage: 'Rate limit exceeded',
				id: (ctx) => ctx.ip,
				headers: {
					remaining: 'Rate-Limit-Remaining',
					reset: 'Rate-Limit-Reset',
					total: 'Rate-Limit-Total',
				},
				disableHeader: false,
				// whitelist: (ctx) => {
				// 	// some logic that returns a boolean
				// },
				// blacklist: (ctx) => {
				// 	// some logic that returns a boolean
				// },
			})
		)
	}

	private async fetch(path: string): Promise<Response> {
		if (!this.transformerURL) {
			throw new Error('Transformer URL not set. Cannot talk to HTTP transformer.')
		}
		const res = await fetch(`${this.transformerURL}${path}`)
		if (!res.ok) {
			throw new Error(`Request to fetch from transformer failed: ${res.status} ${res.statusText}`, { cause: res })
		}
		return res
	}

	async init(): Promise<void> {
		this.router.get('/hello', async (ctx, next) => {
			ctx.body = { msg: 'Hello World', params: ctx.params }
			await next()
		})

		// Proxy
		this.router.get(['/quantel{/*rest}', '/gv{/*rest}'], async (ctx) => {
			try {
				// this.logger.debug(`Pass-through requests to transformer: ${ctx.path}`)
				if (!this.transformerURL) {
					ctx.status = 502
					ctx.body = 'Transformer URL not set. Cannot talk to HTTP transformer.'
					this.logger.warn('Transformer URL not set. Cannot talk to HTTP transformer.')
					return
				}
				if (ctx.path.endsWith('init.mp4')) {
					const initReq = await this.fetch(`${ctx.path}`)
					const initBuf = Buffer.from(await initReq.arrayBuffer())
					const stsc = initBuf.indexOf('stsc')
					initBuf.writeUInt32BE(0, stsc + 8)
					const stco = initBuf.indexOf('stco')
					initBuf.writeUInt32BE(0, stco + 8)
					ctx.type = initReq.headers.get('content-type') || 'video/mpeg-4'
					ctx.body = initBuf
					return
				}
				if (this.smoothStream && ctx.path.endsWith('stream.mpd')) {
					const smoothFestRes = await this.fetch(`${ctx.path.slice(0, -4)}.xml`)
					ctx.type = 'application/xml'
					ctx.body = await manifestTransform(await smoothFestRes.text())
					return
				} else {
					// TODO - ideally this would stream - but that would hang on longer payloads
					const initReq = await this.fetch(`${ctx.path}`)
					ctx.type = initReq.headers.get('content-type') || 'application/octet-stream'
					ctx.body = initReq.body

					// await next() // todo: should we do this?
				}
			} catch (err: any) {
				if (err instanceof Error && err.cause instanceof Response) {
					// Pass through response:
					ctx.status = err.cause.status
					ctx.body = err.cause.body
					if (err.cause.headers) {
						for (const header of Object.keys(err.cause.headers)) {
							const value = err.cause.headers.get(header)
							if (value === null) continue
							ctx.set(header, value)
						}
					}
				} else {
					ctx.status = 502
					ctx.body = 'Bad Gateway'
					this.logger.error(JSON.stringify(err))
					return
				}
			}
		})
		this.router.get('/{/*path}', async (ctx, next) => {
			const relativeUrl = `${ctx.path}` + (ctx.querystring ? `?${ctx.querystring}` : '')
			try {
				const initReq = await this.fetch(relativeUrl)
				ctx.type = initReq.headers.get('content-type') || 'application/octet-stream'
				ctx.body = initReq.body

				await next()
			} catch (err: any) {
				if (err instanceof Error && err.cause instanceof Response) {
					// Pass through response:
					ctx.status = err.cause.status
					ctx.body = err.cause.body
					if (err.cause.headers) {
						for (const header of Object.keys(err.cause.headers)) {
							const value = err.cause.headers.get(header)
							if (value === null) continue
							ctx.set(header, value)
						}
					}
				} else {
					ctx.status = 502
					ctx.body = 'Bad Gateway'
					this.logger.error(`Error when requesting URL "${relativeUrl}"`)
					this.logger.error(JSON.stringify(err))
					return
				}
			}
		})

		this.app.use(this.router.routes()).use(this.router.allowedMethods())

		return new Promise<void>((resolve) => {
			const port = this.config.quantelHTTPTransformerProxy.port
			if (port) {
				this.app.listen(port, () => {
					this.logger.info(`Quantel-HTTP-transformer-proxy: Server started on HTTP port ${port}`)
					resolve()
				})
			}
		})
	}
}

async function manifestTransform(ssxml: string): Promise<string> {
	const ssjs = await xmlParser(ssxml)
	const ssm = ssjs.SmoothStreamingMedia
	const duration = (+ssm.$.Duration / +ssm.$.TimeScale).toFixed(3)
	const video = ssjs.SmoothStreamingMedia.StreamIndex.find((x: any): any => x.$.Type === 'video')
	const header =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<MPD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:scte35="http://www.scte.org/schemas/35/2014SCTE35.xsd" xsi:schemaLocation="urn:mpeg:dash:schema:mpd:2011 DASH-MPD.xsd" profiles="urn:mpeg:dash:profile:isoff-live:2011" type="static" minBufferTime="PT5.000S" maxSegmentDuration="PT3.000S" availabilityStartTime="2016-01-20T21:10:02Z" mediaPresentationDuration="PT${duration}S">\n` +
		`  <Period id="period0" duration="PT${duration}S">\n`
	let vAdapt = `    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1" maxWidth="${video.$.DisplayWidth}" maxHeight="${video.$.DisplayHeight}" maxFrameRate="${video.$.Fps}" par="1:1">\n`
	for (const ql of video.QualityLevel) {
		vAdapt += `      <Representation id="${ql.$.Bitrate}" bandwidth="${ql.$.Bitrate}" codecs="avc1.4D401E" width="${ql.$.MaxWidth}" height="${ql.$.MaxHeight}" frameRate="${video.$.Fps}" sar="1:1" scanType="progressive">\n`
		vAdapt += `        <BaseURL>stream-mp4/video/</BaseURL>\n`
		vAdapt += `        <SegmentTemplate timescale="${ssm.$.TimeScale}" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Time$.mp4" duration="${ssm.$.Duration}" presentationTimeOffset="0">\n`
		vAdapt += `          <SegmentTimeline>\n`
		for (const seg of video.c) {
			vAdapt += `            <S t="${seg.$.t}" d="${seg.$.d}" />\n`
		}
		vAdapt += `          </SegmentTimeline>\n`
		vAdapt += `        </SegmentTemplate>\n`
		vAdapt += `      </Representation>\n`
	}
	vAdapt += `    </AdaptationSet>\n`
	const audio = ssjs.SmoothStreamingMedia.StreamIndex.find((x: any): any => x.$.Type === 'audio')
	let aAdapt = ''
	if (audio) {
		const ql = audio.QualityLevel[0].$
		aAdapt += `    <AdaptationSet mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1" lang="qaa">\n`
		aAdapt += `      <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2" audioSamplingRate="48000">\n`
		aAdapt += `        <BaseURL>${audio.$.Url.slice(0, audio.$.Url.indexOf('{'))}</BaseURL>\n`
		aAdapt += `        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${ql.Channels}"/>\n`
		aAdapt += `        <SegmentTemplate timescale="${ssm.$.TimeScale}" initialization="init.mp4" media="$Time$.mp4" duration="${ssm.$.Duration}" presentationTimeOffset="0">\n`
		aAdapt += `          <SegmentTimeline>\n`
		for (const seg of audio.c) {
			aAdapt += `            <S t="${seg.$.t}" d="${seg.$.d}" />\n`
		}
		aAdapt += `          </SegmentTimeline>\n`
		aAdapt += `        </SegmentTemplate>\n`
		aAdapt += `      </Representation>\n`
		aAdapt += `    </AdaptationSet>\n`
	}
	const footer = `  </Period>\n` + `</MPD>\n`
	return header + vAdapt + aAdapt + footer
}
