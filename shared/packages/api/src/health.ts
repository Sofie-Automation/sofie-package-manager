import Koa from 'koa'
import Router from '@koa/router'
import { StatusCode } from '@sofie-automation/shared-lib/dist/lib/status'
import { assertNever } from '@sofie-automation/shared-lib/dist/lib/lib'
import { getPrometheusMetricsString, PrometheusHTTPContentType, setupPrometheusMetrics } from './prometheus'
import type { HealthConfig } from './config'

export interface HealthCallbacks {
	getStatus?: () => { statusCode: StatusCode; messages: string[] }
	isReady?: () => boolean
}

/**
 * Exposes health endpoints for Kubernetes or other orchestrators to monitor.
 * Also exposes a /metrics endpoint for Prometheus.
 * @see https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes
 */
export class HealthEndpoints {
	private app = new Koa()

	constructor(private config: HealthConfig, private callbacks?: HealthCallbacks) {
		if (!config.port) return // disabled

		// Setup default prometheus metrics when endpoints are enabled
		setupPrometheusMetrics()

		const router = new Router()

		router.get('/healthz', async (ctx) => {
			if (!this.callbacks?.getStatus) {
				ctx.status = 200
				ctx.body = 'OK'
				return
			}

			const status = this.callbacks.getStatus()

			if (status.statusCode === StatusCode.UNKNOWN) ctx.status = 503
			else if (status.statusCode === StatusCode.FATAL) ctx.status = 503
			else if (status.statusCode === StatusCode.BAD) ctx.status = 503
			else if (status.statusCode === StatusCode.WARNING_MAJOR) ctx.status = 200
			else if (status.statusCode === StatusCode.WARNING_MINOR) ctx.status = 200
			else if (status.statusCode === StatusCode.GOOD) ctx.status = 200
			else assertNever(status.statusCode)

			if (ctx.status !== 200) {
				ctx.body = `Status: ${StatusCode[status.statusCode]}, messages: ${status.messages.join(', ')}`
			} else {
				ctx.body = 'OK'
			}
		})

		router.get('/readyz', async (ctx) => {
			if (!this.callbacks?.isReady) {
				ctx.status = 200
				ctx.body = 'READY'
				return
			}

			if (!this.callbacks.isReady()) {
				ctx.status = 503
				ctx.body = 'Not ready'
				return
			}

			ctx.status = 200
			ctx.body = 'READY'
		})

		router.get('/metrics', async (ctx) => {
			try {
				ctx.response.type = PrometheusHTTPContentType
				ctx.body = await getPrometheusMetricsString()
			} catch (ex) {
				ctx.response.status = 500
				ctx.body = ex + ''
			}
		})

		this.app.use(router.routes()).use(router.allowedMethods())
		this.app.listen(this.config.port)
	}
}
