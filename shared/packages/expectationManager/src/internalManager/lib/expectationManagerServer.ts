import {
	assertNever,
	ClientConnection,
	ClientConnectionOptions,
	LoggerInstance,
	StatusCode,
	stringifyError,
	URLMap,
	WebsocketServer,
	WorkerAgentId,
} from '@sofie-package-manager/api'
import { ExpectationManagerServerOptions } from '../../expectationManager'
import { WorkerAgentAPI } from '../../workerAgentApi'

import { InternalManager } from '../internalManager'

/**  */
export class ExpectationManagerServer {
	public websocketServer?: WebsocketServer

	/** The URL on which the expectationManager can be reached on */
	private _serverAccessUrls: URLMap = {
		'*': '',
	}

	private logger: LoggerInstance
	constructor(
		logger: LoggerInstance,
		private manager: InternalManager,
		private serverOptions: ExpectationManagerServerOptions,
		private readonly serverAccessBaseUrls: URLMap | undefined,
		private workForceConnectionOptions: ClientConnectionOptions
	) {
		this.logger = logger.category('ExpMgrServer')

		if (this.serverOptions.type === 'websocket') {
			this.websocketServer = new WebsocketServer(
				this.serverOptions.port,
				this.logger,
				(client: ClientConnection) => {
					// A new client has connected

					this.logger.info(`New ${client.clientType} connected, id "${client.clientId}"`)

					switch (client.clientType) {
						case 'workerAgent': {
							const clientId = client.clientId as WorkerAgentId
							const expectationManagerMethods = this.manager.getWorkerAgentAPI(clientId)

							const api = new WorkerAgentAPI(this.manager.managerId, expectationManagerMethods, {
								type: 'websocket',
								clientConnection: client,
							})
							this.manager.workerAgents.upsert(clientId, { api, connected: true })
							client.once('close', () => {
								this.logger.warn(`Connection from Worker "${clientId}" closed`)

								const workerAgent = this.manager.workerAgents.get(clientId)
								if (workerAgent) {
									workerAgent.connected = false
									this.manager.workerAgents.remove(clientId)
								}
							})
							this.logger.info(`Connection from Worker "${clientId}" established`)
							this.manager.tracker.triggerEvaluationNow()
							break
						}
						case 'N/A':
						case 'expectationManager':
						case 'appContainer':
							throw new Error(`Unsupported clientType "${client.clientType}"`)
						default: {
							assertNever(client.clientType)
							throw new Error(`Unknown clientType "${client.clientType}"`)
						}
					}
				}
			)

			this.websocketServer.on('error', (err: unknown) => {
				this.logger.error(`WebsocketServer error: ${stringifyError(err)}`)
			})
			this.websocketServer.on('close', () => {
				this.logger.error(`WebsocketServer closed`)
				this.manager.statuses.update('expectationManager.server', {
					statusCode: StatusCode.FATAL,
					message: 'ExpectationManager server closed (Restart Package Manager)',
				})
			})
			this.logger.info(`Expectation Manager running on port ${this.websocketServer.port}`)
		} else {
			// todo: handle direct connections
		}
	}
	public async init(): Promise<void> {
		if (this.workForceConnectionOptions.type === 'internal') {
			this._serverAccessUrls = {
				'*': '__internal',
			}
		} else if (this.serverAccessBaseUrls) {
			this._serverAccessUrls = this.serverAccessBaseUrls
		} else {
			this._serverAccessUrls = {
				'*': 'ws://127.0.0.1',
			}
		}
		this.logger.info(`##### type: ${this.workForceConnectionOptions.type}`)
		if (this.serverOptions.type === 'websocket' && this.serverOptions.port === 0) {
			this.logger.info(`##### this.serverOptions.port: ${this.serverOptions.port}`)
			// When the configured port i 0, the next free port is picked
			for (const key of Object.keys(this._serverAccessUrls)) {
				// If no port was specified in the url, add it:
				if (!this._serverAccessUrls[key].match(/\/\/[^/]+:\d/)) {
					this.logger.info(`updateing ${key}`)
					this._serverAccessUrls[key] += `:${this.manager.expectationManagerServer.websocketServer?.port}`
				}
			}
		}

		this.logger.info(`##### this.serverAccessBaseUrls: ${JSON.stringify(this.serverAccessBaseUrls)}`)
		this.logger.info(`##### websocketServer?.port: ${this.manager.expectationManagerServer.websocketServer?.port}`)
		this.logger.info(`##### this._serverAccessUrls: ${JSON.stringify(this._serverAccessUrls)}`)

		if (!this._serverAccessUrls) throw new Error(`ExpectationManager.serverAccessUrl not set!`)
	}
	terminate(): void {
		if (this.websocketServer) {
			this.websocketServer.terminate()
		}
	}
	public get serverAccessUrls(): URLMap {
		return this._serverAccessUrls
	}
}
