import Configstore from 'configstore'

import { CoreCredentials, PeripheralDeviceId, protectString } from '@sofie-automation/server-core-integration'

/**
 * @deprecated This is a modified copy of the old method provided by server-core-integration.
 * This used to use data-store, but data-store was replaced with configstore for ESM compatibility.
 * The question if this should be kept is open.
 */
export function getCredentials(name: string): CoreCredentials {
	const store = new Configstore(name)

	let credentials: CoreCredentials | undefined = store.get('CoreCredentials')
	if (!credentials) {
		credentials = {
			deviceId: protectString<PeripheralDeviceId>(randomString()),
			deviceToken: randomString(),
		}
		store.set('CoreCredentials', credentials)
	}

	return credentials
}

function randomString(length = 20): string {
	const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
	let result = ''
	for (let i = length; i > 0; --i) {
		result += chars[Math.floor(Math.random() * chars.length)]
	}
	return result
}
