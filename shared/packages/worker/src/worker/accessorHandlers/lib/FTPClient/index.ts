import { Accessor, assertNever, LoggerInstance } from '@sofie-package-manager/api'
import { FTPClientBase, FTPOptions } from './base'
import { FTPClient } from './FTPClient'
import { SFTPClient } from './SFTPClient'

export { FTPClientBase, FTPOptions }

/**
 * Factory method to create an FTPClient based on serverType
 */
export function createFTPClient(
	serverType: Accessor.FTP['serverType'],
	logger: LoggerInstance,
	options: FTPOptions
): FTPClientBase {
	if (serverType === 'ftp' || serverType === 'ftp-ssl' || serverType === 'ftps') {
		return new FTPClient(logger, options)
	} else if (serverType === 'sftp') {
		return new SFTPClient(logger, options)
	} else {
		assertNever(serverType)
		throw new Error(`Unknown serverType "${serverType}"`)
	}
}
