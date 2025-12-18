import {
	CopyObjectCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	ListObjectsV2CommandOutput,
	S3Client,
} from '@aws-sdk/client-s3'
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { Readable } from 'node:stream'
import { Upload } from '@aws-sdk/lib-storage'

import { stringifyError } from '@sofie-package-manager/api'

export type ListFilesResultItem = {
	name: string
	isDirectory: boolean
	lastModified: number | undefined
}

export interface S3Options {
	bucketId: string
	accessKey: string
	secretAccessKey: string
	region: string
	s3PublicBaseUrl: string
	endpoint?: string | undefined
	forcePathStyle?: boolean | undefined
}

export type FileInfoReturnType =
	| {
			success: true
			fileInfo: { size: number; modified: number }
	  }
	| {
			success: false
			knownReason: boolean
			packageExists: boolean
			reason: ExpectedPackageStatusAPI.Reason
	  }

export class S3BucketClient {
	private readonly s3Client: S3Client
	constructor(private readonly options: S3Options) {
		this.s3Client = new S3Client({
			forcePathStyle: this.options.forcePathStyle,
			region: this.options.region,
			endpoint: this.options.endpoint,
			credentials: {
				accessKeyId: this.options.accessKey,
				secretAccessKey: this.options.secretAccessKey,
			},
		})
	}

	public async writeFile(
		fullPath: string,
		content: Buffer | string | Readable,
		abortController?: AbortController
	): Promise<void> {
		try {
			const upload = new Upload({
				client: this.s3Client,
				params: {
					Bucket: this.options.bucketId,
					Key: fullPath,
					Body: content,
				},
				abortController: abortController,
			})

			await upload.done()
		} catch (err) {
			throw new Error(
				`Failed to write '${fullPath}' to bucket '${this.options.bucketId}': ${stringifyError(err)}`
			)
		}
	}

	async getFileInfo(fullPath: string): Promise<FileInfoReturnType> {
		try {
			const result = await this.s3Client.send(
				new HeadObjectCommand({
					Bucket: this.options.bucketId,
					Key: fullPath,
				})
			)

			return {
				success: true,
				fileInfo: {
					size: result.ContentLength ?? 0,
					modified: result.LastModified ? result.LastModified.getTime() : 0,
				},
			}
		} catch (err: any) {
			const knownReason = Boolean(err?.name || err?.Code)
			const reason = err?.name || err?.Code || 'UnknownError'

			const packageNotFound = reason === 'NotFound' || reason === 'NoSuchKey'

			return {
				success: false,
				knownReason,
				packageExists: !packageNotFound,
				reason: packageNotFound
					? {
							tech: "Object doesn't exist",
							user: 'The requested file does not exist in the S3 storage bucket',
					  }
					: {
							tech: `S3 Error: ${reason} err: ${stringifyError(err)}`,
							user: 'An unknown error occurred when trying to access the S3 storage bucket',
					  },
			}
		}
	}

	public async removeFileIfExists(fullPath: string): Promise<boolean> {
		try {
			const result = await this.s3Client.send(
				new DeleteObjectCommand({
					Bucket: this.options.bucketId,
					Key: fullPath,
				})
			)

			return result.$metadata.httpStatusCode === 204
		} catch (err) {
			throw new Error(
				`Failed to remove '${fullPath}' from bucket '${this.options.bucketId}': ${stringifyError(err)}`
			)
		}
	}

	public async listFilesInDir(fullPath: string): Promise<ListFilesResultItem[]> {
		const prefix = S3BucketClient.sanitizeDirName(fullPath)

		const results: ListFilesResultItem[] = []

		let continuationToken: string | undefined = undefined
		do {
			try {
				const response: ListObjectsV2CommandOutput = await this.s3Client.send(
					new ListObjectsV2Command({
						Bucket: this.options.bucketId,
						Prefix: prefix,
						Delimiter: '/',
						ContinuationToken: continuationToken,
					})
				)

				continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined

				results.push(
					...S3BucketClient.getDirectoryNamesFromCommonPrefixesListResponse(response.CommonPrefixes, prefix),
					...S3BucketClient.getFilesFromListResponse(response.Contents, prefix)
				)
			} catch (err) {
				throw new Error(
					`Failed to list files in '${fullPath}' from bucket '${this.options.bucketId}': ${stringifyError(
						err
					)}`
				)
			}
		} while (continuationToken)

		return results
	}

	private static getDirectoryNamesFromCommonPrefixesListResponse(
		commonPrefixes: ListObjectsV2CommandOutput['CommonPrefixes'] | undefined,
		prefix: string
	) {
		const results = []

		for (const cp of commonPrefixes || []) {
			if (!cp.Prefix) continue
			const raw = cp.Prefix
			const name = raw.substring(prefix.length).replace(/\/$/, '')
			if (name === '') continue
			results.push({
				name,
				isDirectory: true,
				lastModified: undefined,
			})
		}

		return results
	}

	async renameFile(from: string, to: string): Promise<void> {
		await this.s3Client.send(
			new CopyObjectCommand({
				Bucket: this.options.bucketId,
				CopySource: `${this.options.bucketId}/${from}`,
				Key: to,
			})
		)

		await this.s3Client.send(
			new DeleteObjectCommand({
				Bucket: this.options.bucketId,
				Key: from,
			})
		)
	}

	public async fileExists(
		fullPath: string
	): Promise<{ exists: true } | { exists: false; reason: ExpectedPackageStatusAPI.Reason; knownReason: boolean }> {
		try {
			const listResult = await this.s3Client.send(
				new ListObjectsV2Command({
					Bucket: this.options.bucketId,
					Prefix: fullPath,
					MaxKeys: 1,
				})
			)

			const exists = listResult.Contents?.some((obj) => obj.Key === fullPath)

			if (!exists) {
				return {
					exists: false,
					knownReason: true,
					reason: {
						user: `File not found`,
						tech: `File "${fullPath}" not found in S3 bucket`,
					},
				}
			}

			return {
				exists: true,
			}
		} catch (err: any) {
			return {
				exists: false,
				knownReason: false,
				reason: {
					user: `Error response from S3`,
					tech: `S3: [${err?.code}]: ${stringifyError(err)}`,
				},
			}
		}
	}

	public async readFile(fullPath: string, abortSignal?: AbortSignal): Promise<ReadableStream> {
		try {
			const response = await this.s3Client.send(
				new GetObjectCommand({
					Bucket: this.options.bucketId,
					Key: fullPath,
				}),
				{ abortSignal }
			)

			if (!response.Body) {
				throw new Error(`Failed to read '${fullPath}' from bucket: No body in response`)
			}

			return response.Body.transformToWebStream()
		} catch (err) {
			throw new Error(`Failed to read '${fullPath}' from bucket: ${stringifyError(err)}`)
		}
	}

	public async unlinkIfExists(fullPath: string): Promise<boolean> {
		try {
			const result = await this.s3Client.send(
				new DeleteObjectCommand({
					Bucket: this.options.bucketId,
					Key: fullPath,
				})
			)

			return result.DeleteMarker === true || result.VersionId !== undefined
		} catch (err) {
			throw new Error(
				`Failed to unlink '${fullPath}' from bucket '${this.options.bucketId}': ${stringifyError(err)}`
			)
		}
	}

	async removeDirIfExists(fullPath: string): Promise<boolean> {
		const dirPath = fullPath.endsWith('/') ? fullPath : `${fullPath}/`

		const listResult = await this.s3Client.send(
			new ListObjectsV2Command({
				Bucket: this.options.bucketId,
				Prefix: dirPath,
			})
		)

		if (!listResult.Contents || listResult.Contents.length === 0) {
			return false
		}

		const deletePromises = listResult.Contents.map(async (object) =>
			this.s3Client.send(
				new DeleteObjectCommand({
					Bucket: this.options.bucketId,
					Key: object.Key,
				})
			)
		)

		await Promise.all(deletePromises)

		let continuationToken = listResult.NextContinuationToken
		while (continuationToken) {
			const nextListResult = await this.s3Client.send(
				new ListObjectsV2Command({
					Bucket: this.options.bucketId,
					Prefix: dirPath,
					ContinuationToken: continuationToken,
				})
			)

			if (nextListResult.Contents && nextListResult.Contents.length > 0) {
				const deletePromises = nextListResult.Contents.map(async (object) =>
					this.s3Client.send(
						new DeleteObjectCommand({
							Bucket: this.options.bucketId,
							Key: object.Key,
						})
					)
				)

				await Promise.all(deletePromises)
			}

			continuationToken = nextListResult.NextContinuationToken
		}

		return true
	}

	private static getFilesFromListResponse(contents: ListObjectsV2CommandOutput['Contents'], prefix: string) {
		const results = []

		for (const obj of contents || []) {
			if (!obj.Key) continue

			if (obj.Key === prefix) continue

			const name = obj.Key.substring(prefix.length)

			if (name.includes('/')) continue

			results.push({
				name,
				isDirectory: false,
				lastModified: obj.LastModified ? obj.LastModified.getTime() : undefined,
			})
		}

		return results
	}

	private static sanitizeDirName(fullPath: string) {
		if (!fullPath) return ''
		else {
			const fullPathWithoutStartingSlash = fullPath.replace(/^\//, '')

			return fullPathWithoutStartingSlash.endsWith('/')
				? fullPathWithoutStartingSlash.replace(/^\//, '')
				: `${fullPathWithoutStartingSlash.replace(/^\//, '')}/`
		}
	}
}
