/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import EventEmitter from 'node:events'

import { vi } from 'vitest'

// Import the actual module dynamically using Vitest's importActual
const realPackageManagerAPI = await vi.importActual<Record<string, any>>('@sofie-package-manager/api')

type ClientType = 'N/A' | 'workerAgent' | 'expectationManager' | 'appContainer'

class MockClientConnection extends EventEmitter {
	constructor() {
		super()
	}

	public clientType: ClientType = 'N/A'
	public clientId = ''
}

export class WebsocketServer extends EventEmitter {
	constructor(
		public _port: number,
		public _logger: any,
		connectionClb: (client: MockClientConnection) => void
	) {
		super()
		WebsocketServer.connectionClb = connectionClb
	}
	static connectionClb: (connection: MockClientConnection) => void

	static openConnections: MockClientConnection[] = []

	static mockNewConnection(clientId: string, clientType: ClientType): MockClientConnection {
		const newConnection = new MockClientConnection()
		newConnection.clientId = clientId
		newConnection.clientType = clientType
		WebsocketServer.openConnections.push(newConnection)
		WebsocketServer.connectionClb(newConnection)
		return newConnection
	}

	terminate() {
		WebsocketServer.openConnections.forEach((connection) => {
			connection.emit('close')
		})
		this.emit('close')
	}
}

const packageManagerAPI: any = {
	...realPackageManagerAPI,
	WebsocketServer,
}

export default packageManagerAPI
