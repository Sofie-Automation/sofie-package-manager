import SFTP from 'ssh2-sftp-client'
import * as FTP from 'basic-ftp'
import * as path from 'path'
import PQueue from 'p-queue'
import { PassThrough, Readable } from 'stream'
import { Accessor, LoggerInstance, Reason } from '@sofie-package-manager/api'

/** This is a generic FTP Client that support both FTP and SFTP */
export abstract class FTPClientBase {
	constructor(public readonly options: FTPOptions) {}
	abstract destroyed: boolean
	abstract init(): Promise<void>
	abstract destroy(): Promise<void>
	/** Abort current operation */
	abstract abort(): Promise<void>
	abstract fileExists(fullPath: string): Promise<FileExistsReturnType>
	abstract getFileInfo(fullPath: string): Promise<FileInfoReturnType>
	/** @returns null if upload completed without error, string with message otherwise */
	abstract upload(sourceStream: NodeJS.ReadableStream, fullPath: string): Promise<string | null>
	/** @returns null if upload completed without error, string with message otherwise */
	abstract uploadContent(fullPath: string, content: Buffer | string): Promise<string | null>
	abstract download(fullPath: string): Promise<FileDownloadReturnType>
	abstract downloadContent(fullPath: string): Promise<Buffer>
	/** @returns true if the file existed */
	abstract removeFileIfExists(fullPath: string): Promise<boolean>
	abstract renameFile(fullPathFrom: string, fullPathTo: string): Promise<void>
	abstract listFilesInDir(fullPath: string): Promise<
		{
			name: string
			isDirectory: boolean
			lastModified: number | undefined
		}[]
	>
	abstract removeDirIfExists(fullPath: string): Promise<boolean>
}
export type FTPOptions = Omit<Required<Accessor.FTP>, 'label' | 'allowRead' | 'allowWrite' | 'basePath' | 'networkId'>
type FileDownloadReturnType = {
	readableStream: NodeJS.ReadableStream
	onComplete: Promise<void>
}
type FileExistsReturnType =
	| {
			exists: true
	  }
	| {
			exists: false
			knownReason: boolean
			reason: Reason
	  }
type FileInfoReturnType =
	| {
			success: true
			fileInfo: { size: number; modified: number }
	  }
	| {
			success: false
			knownReason: boolean
			packageExists: boolean
			reason: Reason
	  }

/** A FTP Client that supports FTP & FTPS (FTP over TLS) connections. */
export class FTPClient extends FTPClientBase {
	private client: FTP.Client

	private initializing: Promise<void> | null = null
	public destroyed = false

	private logger: LoggerInstance

	constructor(logger: LoggerInstance, options: FTPOptions) {
		super(options)
		this.logger = logger.category('FTPClient')
		if (options.serverType !== 'ftp' && options.serverType !== 'ftps')
			throw new Error('Internal Error: serverType must be "ftp" or "ftps"')

		this.client = this.createFTPClient()
	}
	private createFTPClient(): FTP.Client {
		const ftpClient = new FTP.Client()

		// Because the FTP.Client methods needs to be called ONLY one at a time,
		// we do a hack to override its methods with a promise queue:
		const methodsToOverride: (keyof FTP.Client)[] = [
			'access',
			// 'close',
			// 'closed',
			'downloadTo',
			'ensureDir',
			'lastMod',
			'list',
			'remove',
			'removeDir',
			'rename',
			'size',
			// 'trackProgress',
			'uploadFrom',
		]

		const queue = new PQueue({ concurrency: 1 })

		for (const method of methodsToOverride) {
			const orgMethod = (ftpClient as any)[method] as (...args: any[]) => Promise<any>
			const newMethod = async (...args: any[]) => queue.add(async () => orgMethod.apply(ftpClient, args))
			;(ftpClient as any)[method] = newMethod
		}

		return ftpClient
	}

	async init(): Promise<void> {
		if (!this.client.closed) return // return early, no need to init

		// Ensure only one init is run at the same time:
		if (this.initializing) return this.initializing
		this.initializing = Promise.resolve()
			.then(async () => {
				if (!this.client.closed) return // return, no need to reconnect

				const options: FTP.AccessOptions = {
					host: this.options.host,
					port: this.options.port ?? 21,
					user: this.options.username,
					password: this.options.password,
					secure: this.options.serverType !== 'ftp',
					secureOptions: {
						rejectUnauthorized: this.options.allowAnyCertificate ? false : true, // Allow self-signed certificates
					},
				}
				await this.client.access(options)

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
		this.client.close()

		// Recreate the client
		this.client = this.createFTPClient()
		await this.init()
	}
	async destroy(): Promise<void> {
		this.destroyed = true // Mark as destroyed
		this.client.close()
	}

	async fileExists(fullPath: string): Promise<FileExistsReturnType> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Checking if file exists: ${fullPath}`)

		return this._fileExists(fullPath)
	}
	private async _fileExists(fullPath: string): Promise<FileExistsReturnType> {
		try {
			await this.client.size(fullPath)
		} catch (e) {
			if (e instanceof FTP.FTPError) {
				if (e.code === 550) {
					// 550 means "File not found"
					return {
						exists: false,
						knownReason: true,
						reason: {
							user: `File not found`,
							tech: `File "${fullPath}" not found on FTP server ([${e.code}]: ${e.message})`,
						},
					}
				} else {
					return {
						exists: false,
						knownReason: false,
						reason: {
							user: `Error response from FTP Server`,
							tech: `FTP Server: [${e.code}]: ${e.message}`,
						},
					}
				}
			}
			throw e
		}

		return {
			exists: true,
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

		const size = await this.client.size(fullPath)

		let modDate: Date | undefined = undefined
		try {
			modDate = await this.client.lastMod(fullPath)
		} catch {
			// This is not supported by every FTP server, ignore any error
		}
		return {
			success: true,
			fileInfo: {
				size,
				modified: modDate ? modDate.getTime() : 0,
			},
		}
	}
	async upload(sourceStream: NodeJS.ReadableStream, fullPath: string): Promise<string | null> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Uploading file to: ${fullPath}`)

		// Ensure the directory exists:
		await this.client.ensureDir(path.dirname(fullPath))

		// Remove the file if it already exists:
		await this.client.remove(fullPath, true)

		const response = await this.client.uploadFrom(Readable.from(sourceStream), fullPath)

		// todo: handle progress?
		// this.client.trackProgress((info) => {
		// 	console.log('File', info.name)
		// 	console.log('Type', info.type)
		// 	console.log('Transferred', info.bytes)
		// 	console.log('Transferred Overall', info.bytesOverall)
		// })

		if (response.code === 226) return null // 226 means "Transfer complete"
		else return `[${response.code}]: ${response.message}`
	}
	async uploadContent(fullPath: string, content: Buffer | string): Promise<string | null> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Uploading content to: ${fullPath}`)

		// Ensure the directory exists:
		await this.client.ensureDir(path.dirname(fullPath))

		const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')

		// Feed the buffer into a readable stream:
		const readableStream = Readable.from(buffer)
		// Upload the readable stream:
		const response = await this.client.uploadFrom(readableStream, fullPath)

		if (response.code === 226) return null // 226 means "Transfer complete"
		else return `[${response.code}]: ${response.message}`
	}

	async download(fullPath: string): Promise<FileDownloadReturnType> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Downloading file from: ${fullPath}`)

		const passThroughStream = new PassThrough()

		const pResponse = this.client.downloadTo(passThroughStream, fullPath).then((_response) => {
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

		const download = await this.download(fullPath)

		// Put readable stream into a Buffer and return that:
		return new Promise((resolve, reject) => {
			const chunks: Uint8Array[] = []
			download.readableStream.on('data', (chunk) => {
				chunks.push(chunk)
			})
			download.readableStream.on('end', () => {
				resolve(Buffer.concat(chunks))
			})
			download.readableStream.on('error', (err) => {
				reject(err)
			})
			download.onComplete.catch((err) => {
				reject(err)
			})
		})
	}
	async removeFileIfExists(fullPath: string): Promise<boolean> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Removing file if exists: ${fullPath}`)

		// Check if file exists
		const response = await this._fileExists(fullPath)
		if (response.exists) {
			await this.client.remove(fullPath)

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
				isDirectory: file.isDirectory,
				lastModified: file.modifiedAt ? file.modifiedAt.getTime() : undefined,
			}
		})
	}
	async removeDirIfExists(fullPath: string): Promise<boolean> {
		await this.init() // Ensure the client is connected

		const response = await this._fileExists(fullPath)
		if (response.exists) {
			await this.client.removeDir(fullPath)

			return true
		} else {
			return false
		}
	}
}

/** A SFTP Client that supports SFTP (FTP/SSH) connections. */
export class SFTPClient extends FTPClientBase {
	private client = new SFTP()

	private initializing: Promise<void> | null = null
	public connected = false
	public destroyed = false

	private logger: LoggerInstance

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

	private _onClose = () => {
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
	async upload(sourceStream: NodeJS.ReadableStream, fullPath: string): Promise<string | null> {
		await this.init() // Ensure the client is connected

		this.logger.debug(`Uploading file to: ${fullPath}`)

		// Ensure the directory exists:
		await this.client.mkdir(path.dirname(fullPath), true)

		// Remove the file if it already exists:
		await this.client.delete(fullPath, true)

		await this.client.put(Readable.from(sourceStream), fullPath)
		return null
	}
	async uploadContent(fullPath: string, content: Buffer | string): Promise<string | null> {
		await this.init() // Ensure the client is connected

		this.logger.debug(`Uploading content to: ${fullPath}`)

		// Ensure the directory exists:
		await this.client.mkdir(path.dirname(fullPath), true)

		// Upload the readable stream:
		const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
		await this.client.put(buf, fullPath)

		return null
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
