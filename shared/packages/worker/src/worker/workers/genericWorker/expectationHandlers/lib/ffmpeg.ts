import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import path from 'path'
import { mkdir as fsMkDir } from 'fs/promises'
import {
	isFileShareAccessorHandle,
	isFTPAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../../accessorHandlers/accessor'
import { FileShareAccessorHandle } from '../../../../accessorHandlers/fileShare'
import { HTTPProxyAccessorHandle } from '../../../../accessorHandlers/httpProxy'
import { LocalFolderAccessorHandle } from '../../../../accessorHandlers/localFolder'
import {
	assertNever,
	escapeFilePath,
	stringifyError,
	FFMpegProcess,
	getFFMpegExecutable,
	testFFMpeg,
	testFFProbe,
	overrideFFMpegExecutables,
	getFFProbeExecutable,
	ExecutableAliasSource,
} from '@sofie-package-manager/api'
import { FTPAccessorHandle } from '../../../../accessorHandlers/ftp'
import { BaseWorker } from '../../../../worker'

export { FFMpegProcess, testFFMpeg, testFFProbe, overrideFFMpegExecutables, getFFProbeExecutable, getFFMpegExecutable }

/** Spawn an ffmpeg process and make it to output its content to the target */
export async function spawnFFMpeg<Metadata>(
	worker: BaseWorker | ExecutableAliasSource,
	/** Arguments to send into ffmpeg, excluding the final arguments for output */
	args: string[],
	targetHandle:
		| LocalFolderAccessorHandle<Metadata>
		| FileShareAccessorHandle<Metadata>
		| HTTPProxyAccessorHandle<Metadata>
		| FTPAccessorHandle<Metadata>,
	onDone: () => Promise<void>,
	onFail: (err?: any) => Promise<void>,
	onProgress?: (progress: number) => Promise<void>,
	onStart?: (ffMpegProcess: ChildProcessWithoutNullStreams) => void,
	log?: (str: string) => void
): Promise<FFMpegProcess> {
	const { pipeStdOut, args: args2 } = await prepareSpawnFFMpegProcess(args, targetHandle)

	return spawnFFMpegProcess({
		worker,
		pipeStdOut,
		args: args2,
		targetHandle,
		onDone,
		onFail,
		onProgress,
		onStart,
		log,
	})
}
/**
 * Prepare for spawning an ffmpeg process by ensuring target paths exist etc.
 */
async function prepareSpawnFFMpegProcess<Metadata>(
	/** Arguments to send into ffmpeg, excluding the final arguments for output */
	args: string[],
	targetHandle:
		| LocalFolderAccessorHandle<Metadata>
		| FileShareAccessorHandle<Metadata>
		| HTTPProxyAccessorHandle<Metadata>
		| FTPAccessorHandle<Metadata>
): Promise<{ pipeStdOut: boolean; args: string[] }> {
	let pipeStdOut = false

	if (isLocalFolderAccessorHandle(targetHandle)) {
		await fsMkDir(path.dirname(targetHandle.fullPath), { recursive: true }) // Create folder if it doesn't exist
		args.push(escapeFilePath(targetHandle.fullPath))
	} else if (isFileShareAccessorHandle(targetHandle)) {
		await targetHandle.prepareFileAccess()
		await fsMkDir(path.dirname(targetHandle.fullPath), { recursive: true }) // Create folder if it doesn't exist
		args.push(escapeFilePath(targetHandle.fullPath))
	} else if (isHTTPProxyAccessorHandle(targetHandle)) {
		pipeStdOut = true
		args.push('pipe:1') // pipe output to stdout
	} else if (isFTPAccessorHandle(targetHandle)) {
		if (targetHandle.ftpUrl.url.startsWith('ftps://') || targetHandle.ftpUrl.url.startsWith('sftp://')) {
			// ffmpeg doesn't support ftps protocol, stream instead
			pipeStdOut = true
			args.push('pipe:1') // pipe output to stdout
		} else {
			args.push(escapeFilePath(targetHandle.ftpUrl.url))
		}
	} else {
		assertNever(targetHandle)
		throw new Error(`Unsupported Target AccessHandler`)
	}

	return { pipeStdOut, args }
}
/** Spawn an ffmpeg process and make it to output its content to the target */
function spawnFFMpegProcess<Metadata>(props: {
	worker: BaseWorker | ExecutableAliasSource
	/** Arguments to send into ffmpeg, excluding the final arguments for output */
	args: string[]
	targetHandle:
		| LocalFolderAccessorHandle<Metadata>
		| FileShareAccessorHandle<Metadata>
		| HTTPProxyAccessorHandle<Metadata>
		| FTPAccessorHandle<Metadata>
	onDone: () => Promise<void>
	onFail: (err?: any) => Promise<void>
	onProgress?: (progress: number) => Promise<void>
	onStart?: (ffMpegProcess: ChildProcessWithoutNullStreams) => void
	log?: (str: string) => void
	pipeStdOut: boolean
}): FFMpegProcess {
	let FFMpegIsDone = false
	let uploadIsDone = false

	const maybeDone = () => {
		if (FFMpegIsDone && uploadIsDone) {
			props.onDone().catch((error) => {
				// workInProgress._reportError(error)
				props
					.onFail(error)
					.catch((error) => props.log?.(`spawnFFMpeg onFail callback failed: ${stringifyError(error)}`))
			})
		}
	}

	props.log?.('ffmpeg: spawn..')
	let ffMpegProcess: ChildProcessWithoutNullStreams | undefined = spawn(
		getFFMpegExecutable(props.worker),
		props.args,
		{
			windowsVerbatimArguments: true, // To fix an issue with ffmpeg.exe on Windows
		}
	)
	props.log?.('ffmpeg: spawned')

	function killFFMpeg() {
		// ensure this function doesn't throw, since it is called from various error event handlers
		try {
			ffMpegProcess?.stdin?.write('q') // send "q" to quit, because .kill() doesn't quite do it.
			ffMpegProcess?.kill()
		} catch (e) {
			// This is probably OK, errors likely means that the process is already dead
		}
		ffMpegProcess = undefined
	}
	props.onStart?.(ffMpegProcess)

	const lastFewLines: string[] = []

	ffMpegProcess.stderr.on('data', (data) => {
		const str = data.toString()

		props.log?.('ffmpeg:' + str)

		lastFewLines.push(str)

		if (lastFewLines.length > 10) {
			lastFewLines.shift()
		}
	})
	ffmpegInterpretProgress(ffMpegProcess, (progress) => {
		props
			.onProgress?.(progress)
			.catch((err) => props.log?.(`spawnFFMpeg onProgress update failed: ${stringifyError(err)}`))
	})
	const onClose = (code: number | null) => {
		if (ffMpegProcess) {
			props.log?.('ffmpeg: close ' + code)
			ffMpegProcess = undefined
			if (code === 0) {
				FFMpegIsDone = true
				maybeDone()
			} else {
				// workInProgress._reportError(new Error(`FFMpeg exit code ${code}: ${lastFewLines.join('\n')}`))
				props
					.onFail(new Error(`FFMpeg exit code ${code}: ${lastFewLines.join('\n')}`))
					.catch((err) => props.log?.(`spawnFFMpeg onFail callback failed: ${stringifyError(err)}`))
			}
		}
	}
	ffMpegProcess.on('close', (code) => {
		onClose(code)
	})
	ffMpegProcess.on('exit', (code) => {
		onClose(code)
	})
	ffMpegProcess.on('error', (err) => {
		props.log?.(`spawnFFMpeg error: ${stringifyError(err)}`)
	})
	// ffMpegProcess.signalCode

	if (props.pipeStdOut) {
		props.log?.('ffmpeg: pipeStdOut')
		if (!ffMpegProcess.stdout) {
			throw new Error('No stdout stream available')
		}

		props.targetHandle
			.putPackageStream(ffMpegProcess.stdout)
			.then((writeStream) => {
				writeStream.on('error', (err) => {
					props.onFail(err).catch((error) => props.log?.(`onFail callback failed: ${stringifyError(error)}`))
					props.log?.('ffmpeg: pipeStdOut err: ' + stringifyError(err))
					killFFMpeg()
				})
				writeStream.once('close', () => {
					uploadIsDone = true

					maybeDone()
					props.log?.('ffmpeg: pipeStdOut done')
				})
			})
			.catch((err) => {
				props.onFail(err).catch((error) => props.log?.(`onFail callback failed: ${stringifyError(error)}`))
			})
	} else {
		uploadIsDone = true // no upload
	}

	return {
		pid: ffMpegProcess?.pid ?? 0,
		cancel: () => {
			killFFMpeg()
			props
				.onFail(`Cancelled`)
				.catch((err) => props.log?.(`spawnFFMpeg onFail callback failed: ${stringifyError(err)}`))
		},
	}
}

export function ffmpegInterpretProgress(
	ffMpegProcess: ChildProcessWithoutNullStreams,
	cbProgress: (progress: number) => void
): void {
	let fileDuration: number | undefined = undefined
	ffMpegProcess.stderr.on('data', (data) => {
		const str = data.toString()

		// Duration is reported by FFMpeg at the beginning, this means that it successfully opened the source
		// stream and has begun processing
		const m = str.match(/Duration:\s?(\d+):(\d+):([\d.]+)/)
		if (m) {
			const hh = m[1]
			const mm = m[2]
			const ss = m[3]

			fileDuration = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)

			return
		}
		if (fileDuration) {
			// Time position in source is reported periodically, but we need fileDuration to convert that into
			// percentages
			const m2 = str.match(/time=\s?(\d+):(\d+):([\d.]+)/)
			if (m2) {
				const hh = m2[1]
				const mm = m2[2]
				const ss = m2[3]

				const progress = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)

				cbProgress(progress / fileDuration)
				return
			}
		}
	})
}
