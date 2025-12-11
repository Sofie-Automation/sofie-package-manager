import { PassThrough, Readable } from 'node:stream'
import * as path from 'node:path'
import * as FTP from 'basic-ftp'
import PQueue from 'p-queue'
import { LoggerInstance } from '@sofie-package-manager/api'
import { FileDownloadReturnType, FileExistsReturnType, FileInfoReturnType, FTPClientBase, FTPOptions } from './base'

/** A FTP Client that supports FTP & FTPS (FTP over TLS) connections. */
export class FTPClient extends FTPClientBase {
	private client: FTP.Client

	private initializing: Promise<void> | null = null
	public destroyed = false

	private readonly logger: LoggerInstance

	constructor(logger: LoggerInstance, options: FTPOptions) {
		super(options)
		this.logger = logger.category('FTPClient')
		if (!['ftp', 'ftps', 'ftp-ssl'].includes(options.serverType))
			throw new Error('Internal Error: serverType must be "ftp", "ftps" or "ftp-ssl"')

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
			const newMethod = async (...args: any[]) => {
				return queue.add(async () => {
					const orgError = new Error(`Error executing ${method}: ${JSON.stringify(args)}`) // Used later
					try {
						const result = await orgMethod.apply(ftpClient, args)
						return result
					} catch (e) {
						if (typeof e === 'object' && e !== null && 'stack' in e) {
							e.stack += `\nOriginal stack: ${orgError.stack}`
						}
						throw e
					}
				})
			}
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
					secure:
						this.options.serverType === 'ftp'
							? false
							: this.options.serverType === 'ftp-ssl'
							? 'implicit'
							: true, // 'sftp'
					secureOptions: {
						rejectUnauthorized: !this.options.allowAnyCertificate, // Allow self-signed certificates
					},
				}
				await this.client.access(options)
				await this.client.cd('/')

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
	async upload(sourceStream: NodeJS.ReadableStream, fullPath: string): Promise<void> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Uploading file to: ${fullPath}`)

		// Ensure the directory exists:
		await this.client.ensureDir(path.dirname(fullPath))
		await this.client.cd('/') // Revert to root after ensureDir

		// Remove the file if it already exists:
		await this.client.remove(fullPath, true)

		const response = await this.client.uploadFrom(Readable.from(sourceStream), fullPath)

		if (response.code !== 226) {
			// 226 means "Transfer complete"
			throw new Error(`Upload failed: [${response.code}]: ${response.message}`)
		}
	}
	async uploadContent(fullPath: string, content: Buffer | string): Promise<void> {
		await this.init() // Ensure the client is connected

		this.logger.silly(`Uploading content to: ${fullPath}`)

		// Ensure the directory exists:
		await this.client.ensureDir(path.dirname(fullPath))
		await this.client.cd('/') // Revert to root after ensureDir

		const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')

		// Feed the buffer into a readable stream:
		const readableStream = Readable.from(buffer)
		// Upload the readable stream:
		const response = await this.client.uploadFrom(readableStream, fullPath)

		if (response.code !== 226) {
			// 226 means "Transfer complete"
			throw new Error(`Upload failed [${response.code}]: ${response.message}`)
		}
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
			download.readableStream.on('error', (err: Error) => {
				reject(err)
			})
			download.onComplete.catch((err: Error) => {
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
			await this.client.cd('/') // Revert to root after removeDir

			return true
		} else {
			return false
		}
	}
}
