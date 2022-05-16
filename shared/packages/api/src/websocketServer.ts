import WebSocket from 'ws'
import { stringifyError } from './lib'

import { MessageBase, MessageIdentifyClient, PING_TIME, WebsocketConnection } from './websocketConnection'
import { HelpfulEventEmitter } from './HelpfulEventEmitter'
import { LoggerInstance } from './logger'

export type OnMessageHandler = (message: MessageBase) => Promise<any>

export class WebsocketServer extends HelpfulEventEmitter {
	private wss: WebSocket.Server
	private clients: ClientConnection[] = []

	private logger: LoggerInstance
	constructor(port: number, logger: LoggerInstance, private onConnection: (client: ClientConnection) => void) {
		super()
		this.logger = logger.category('WebsocketServer')

		this.wss = new WebSocket.Server({ port: port })

		this.wss.on('close', () => {
			// The websocekt server is closed.

			this.clients.forEach((client) => {
				this.clients = []
				client._onLostConnection()
			})

			this.emit('close')
		})
		this.wss.on('error', (err) => {
			this.emit('error', err)
		})

		this.wss.on('connection', (ws) => {
			// A new client has connected

			const client = new ClientConnection(ws, this.logger, () => Promise.reject('Not setup yet'))
			this.clients.push(client)

			client.once('close', () => {
				// Remove client from the list of clients
				this.clients = this.clients.filter((c) => c !== client)
			})

			client.once('clientTypeReceived', () => {
				// client.clientType has now been set
				this.onConnection(client)
			})
			client.on('error', (err) => {
				this.emit('error', `WebsocketServer ws error, client "${client.clientId}": ${stringifyError(err)}`)
				// TODO: should we close the client?
				// client.close()
			})
		})
	}

	terminate(): void {
		this.clients.forEach((client) => client.close())
		this.wss.close()
	}
	get port(): number {
		const address = this.wss.address()
		if (typeof address === 'string')
			throw new Error(`Internal error: to be implemented: wss.address() as string "${address}"`)

		return address.port
	}
}

export class ClientConnection extends WebsocketConnection {
	private pingInterval: NodeJS.Timeout
	private hasReceivedPingFromClient = true
	private failedPingCount = 0
	public clientType: ClientType = 'N/A'
	public clientId = 'N/A'
	private isClosed = false
	private logger: LoggerInstance

	constructor(ws: WebSocket, logger: LoggerInstance, onMessage: (message: MessageBase) => Promise<any>) {
		super(onMessage)
		this.logger = logger.category('ClientConnection')
		this.ws = ws

		// Continuously ping the client:
		this.pingInterval = setInterval(() => {
			if (this.ws) {
				if (!this.hasReceivedPingFromClient) {
					this.failedPingCount++

					if (this.failedPingCount > 2) {
						this.logger.warn(`Ping failed, closing connection "${this.clientType}", "${this.clientId}"`)

						this.ws.terminate()
						delete this.ws
						this._onLostConnection()
					} else {
						this.logger.warn(
							`Ping failed, count: ${this.failedPingCount}, "${this.clientType}", "${this.clientId}"`
						)
					}
				} else {
					this.hasReceivedPingFromClient = false
					this.ws.ping() // client will reply with 'pong'
				}
			} else {
				// This shouldn't really ever happen
				this._onLostConnection()
			}
		}, PING_TIME)
		this.ws.on('pong', () => {
			this.hasReceivedPingFromClient = true
			this.failedPingCount = 0
		})
		this.ws.on('close', () => {
			this._onLostConnection()
		})
		this.ws.on('message', (messageStr: string) => {
			const message = JSON.parse(messageStr)

			if (message.internalType === 'identify_client') {
				const ident = (message as unknown) as MessageIdentifyClient
				this.clientType = ident.clientType
				this.clientId = ident.id

				this.emit('clientTypeReceived')
			} else {
				this.handleReceivedMessage(message)
			}
		})
		this.ws.on('error', (err) => {
			this.emit('error', err)
		})
	}

	_onLostConnection(): void {
		if (!this.isClosed) {
			this.isClosed = true
			clearTimeout(this.pingInterval)
			this.emit('close')
		}
	}
	close(): void {
		this.ws?.close()
		this._onLostConnection()
	}
}
export type ClientType = MessageIdentifyClient['clientType']
