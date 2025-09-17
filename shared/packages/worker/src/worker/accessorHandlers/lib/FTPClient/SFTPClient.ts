import * as path from 'path'
import { PassThrough, Readable } from 'stream'
import SFTP from 'ssh2-sftp-client'
import { LoggerInstance } from '@sofie-package-manager/api'
import { FileDownloadReturnType, FileExistsReturnType, FileInfoReturnType, FTPClientBase, FTPOptions } from './base'

/** A SFTP Client that supports SFTP (FTP/SSH) connections. */
export class SFTPClient extends FTPClientBase {
	private client = new SFTP()

	private initializing: Promise<void> | null = null
	public connected = false
	public destroyed = false

	private readonly logger: LoggerInstance

	constructor(logger: LoggerInstance, options: FTPOptions) {
		super(options)
		this.logger = logger.category('SFTPClient')
		if (options.serverType !== 'sftp') throw new Error('Internal Error: serverType must be "sftp"')
		this._setupListeners()
	}

	async init(): Promise<void> {
		// Ensure only one init is run at the same time:
		if (this.initializing) return this.initializing

		this.initializing = Promise.resolve()
			.then(async () => {
				if (this.connected) return // return early, no need to reconnect

				const options: SFTP.ConnectOptions = {
					host: this.options.host,
					port: this.options.port ?? 22,
					username: this.options.username,
					password: this.options.password,
					hostVerifier: this.options.allowAnyCertificate ? () => true : undefined, // Allow self-signed certificates
				}
				await this.client.connect(options)
				this.connected = true

				this.initializing = null // Reset initializing promise after successful initialization
			})
			.catch((error) => {
				this.initializing = null // Reset initializing promise on error
				throw error
			})
		await this.initializing
	}

	async abort(): Promise<void> {
		// Abort current operation
		await this._kill()

		// Recreate the client
		this.client = new SFTP()
		this._setupListeners()
		await this.init()
	}
	async destroy(): Promise<void> {
		this.destroyed = true // Mark as destroyed
		await this._kill()
	}

	private readonly _onClose = () => {
		// Called when the connection is closed
		this.connected = false
	}
	private _setupListeners() {
		this.client.on('close', this._onClose)
	}
	private async _kill() {
		this.client.removeListener('close', this._onClose)
		this.connected = false
		await this.client.end()
	}

	async fileExists(fullPath: string): Promise<FileExistsReturnType> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Checking if file exists: ${fullPath}`)

		return this._fileExists(fullPath)
	}
	private async _fileExists(fullPath: string): Promise<FileExistsReturnType> {
		const exist = await this.client.exists(fullPath)
		if (exist === false) {
			return {
				exists: false,
				knownReason: true,
				reason: {
					user: `File not found`,
					tech: `File "${fullPath}" not found on FTP server`,
				},
			}
		} else {
			return {
				exists: true,
			}
		}
	}
	async getFileInfo(fullPath: string): Promise<FileInfoReturnType> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Getting file info for: ${fullPath}`)

		const exists = await this._fileExists(fullPath) // Ensure the file exists before trying to get its info

		if (!exists.exists)
			return {
				success: false,
				knownReason: exists.knownReason,
				reason: exists.reason,

				packageExists: false,
			}
		const stat = await this.client.stat(fullPath)

		return {
			success: true,
			fileInfo: {
				size: stat.size,
				modified: stat.modifyTime,
			},
		}
	}
	async upload(sourceStream: NodeJS.ReadableStream, fullPath: string): Promise<void> {
		await this.init() // Ensure the client is connected

		this.logger.debug(`Uploading file to: ${fullPath}`)

		// Ensure the directory exists:
		await this.client.mkdir(path.dirname(fullPath), true)

		// Remove the file if it already exists:
		await this.client.delete(fullPath, true)

		await this.client.put(Readable.from(sourceStream), fullPath)
	}
	async uploadContent(fullPath: string, content: Buffer | string): Promise<void> {
		await this.init() // Ensure the client is connected

		this.logger.debug(`Uploading content to: ${fullPath}`)

		// Ensure the directory exists:
		await this.client.mkdir(path.dirname(fullPath), true)

		// Upload the readable stream:
		const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
		await this.client.put(buf, fullPath)
	}

	async download(fullPath: string): Promise<FileDownloadReturnType> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Downloading file from: ${fullPath}`)

		const passThroughStream = new PassThrough()

		const pResponse = this.client.get(fullPath, passThroughStream).then((_response) => {
			return undefined
		})

		return {
			readableStream: passThroughStream,
			onComplete: pResponse,
		}
	}
	async downloadContent(fullPath: string): Promise<Buffer> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Downloading content from: ${fullPath}`)

		const buf = await this.client.get(fullPath, undefined)

		if (!(buf instanceof Buffer)) throw new Error(`Internal Error: Expected a Buffer, got ${typeof buf}`)

		return buf
	}
	async removeFileIfExists(fullPath: string): Promise<boolean> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Removing file if exists: ${fullPath}`)

		// Check if file exists
		const response = await this._fileExists(fullPath)
		if (response.exists) {
			await this.client.delete(fullPath)

			return true
		} else {
			return false
		}
	}
	async renameFile(filePathFrom: string, filePathTo: string): Promise<void> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Renaming file from "${filePathFrom}" to "${filePathTo}"`)

		await this.client.rename(filePathFrom, filePathTo)
	}
	async listFilesInDir(fullPath: string): Promise<
		{
			name: string
			isDirectory: boolean
			lastModified: number | undefined
		}[]
	> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Listing files in directory: ${fullPath}`)

		const fileInfo = await this.client.list(fullPath)

		return fileInfo.map((file) => {
			return {
				name: file.name,
				isDirectory: file.type === 'd',
				lastModified: file.modifyTime,
			}
		})
	}
	async removeDirIfExists(fullPath: string): Promise<boolean> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Removing directory if exists: ${fullPath}`)

		const response = await this._fileExists(fullPath)
		if (response.exists) {
			await this.client.rmdir(fullPath)

			return true
		} else {
			return false
		}
	}
}
