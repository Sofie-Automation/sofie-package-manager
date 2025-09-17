import { Accessor, Reason } from '@sofie-package-manager/api'

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
	/** @returns when uploaded completed*/
	abstract upload(sourceStream: NodeJS.ReadableStream, fullPath: string): Promise<void>
	/** @returns when uploaded completed*/
	abstract uploadContent(fullPath: string, content: Buffer | string): Promise<void>
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
export type FileDownloadReturnType = {
	readableStream: NodeJS.ReadableStream
	onComplete: Promise<void>
}
export type FileExistsReturnType =
	| {
			exists: true
	  }
	| {
			exists: false
			knownReason: boolean
			reason: Reason
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
			reason: Reason
	  }
