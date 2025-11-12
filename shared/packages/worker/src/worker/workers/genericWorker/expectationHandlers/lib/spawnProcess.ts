import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { ffmpegInterpretProgress } from './ffmpeg'
import { stringifyError } from '@sofie-package-manager/api'

export interface SpawnedProcess {
	execProcess: ChildProcessWithoutNullStreams
	cancel: () => void
}
/**
 * Convenience method to spawn a process.
 * Returns a promise that resolves when the process has started.
 */
export async function spawnProcess(
	/** Path to the executable */
	executable: string,
	/** CLI arguments to send into to process */
	args: string[],
	onDone: () => void,
	onError: (err?: any) => void,
	onProgress: (progress: number) => void,
	log?: (str: string) => void
): Promise<SpawnedProcess> {
	const processName = `process-name: ${executable}`
	log?.(`${processName}: spawn..`)
	let execProcess: ChildProcessWithoutNullStreams | undefined = spawn(executable, args, {
		windowsVerbatimArguments: true, // To fix an issue with ffmpeg.exe on Windows
	})
	log?.(`${processName}: spawned`)

	let specialHandling: undefined | 'ffmpeg' | 'KairosConverter' = undefined
	if (executable.includes('ffmpeg')) specialHandling = 'ffmpeg'
	else if (executable.includes('KairosConverter')) specialHandling = 'KairosConverter'

	if (specialHandling) log?.(`${processName}: Special handling: ${specialHandling}`)

	function killProcess() {
		// ensure this function doesn't throw, since it is called from various error event handlers
		try {
			if (specialHandling === 'ffmpeg') {
				execProcess?.stdin?.write('q') // send "q" to quit, because .kill() doesn't quite do it.
			}

			execProcess?.kill()
		} catch (e) {
			// This is probably OK, errors likely means that the process is already dead
		}
		execProcess = undefined
	}

	const lastFewLines: string[] = []

	// let fileDuration: number | undefined = undefined
	execProcess.stdout.on('data', (data) => {
		const str = data.toString()
		log?.(`${processName}.stdout: ${str}`)

		lastFewLines.push(str)
		if (lastFewLines.length > 10) lastFewLines.shift()
	})
	execProcess.stderr.on('data', (data) => {
		const str = data.toString()
		log?.(`${processName}.stderr: ${str}`)

		lastFewLines.push(str)
		if (lastFewLines.length > 10) lastFewLines.shift()

		// TODO: maybe parse some kind of progress here?
	})
	const onClose = (code: number | null) => {
		if (execProcess) {
			log?.(`${processName} close ${code}`)

			execProcess = undefined
			if (code === 0) {
				onDone()
			} else {
				// workInProgress._reportError(new Error(`FFMpeg exit code ${code}: ${lastFewLines.join('\n')}`))
				onError(new Error(`${processName} exit code ${code}: ${lastFewLines.join('\n')} (${args.join(' ')})`))
			}
		}
	}
	execProcess.on('close', (code) => {
		onClose(code)
	})
	execProcess.on('exit', (code) => {
		onClose(code)
	})
	execProcess.on('error', (err) => {
		log?.(`${processName} Error: ${stringifyError(err)}`)
	})

	if (specialHandling === 'ffmpeg') {
		ffmpegInterpretProgress(execProcess, (progress) => {
			onProgress(progress)
		})
	} else if (specialHandling === 'KairosConverter') {
		let prevReportedPercent = -1
		execProcess.stdout.on('data', (data) => {
			const str = data.toString()

			// "2% complete\n"
			const m = str.match(/(\d+)%/)
			if (m) {
				const percent = parseInt(m[1], 10)
				if (percent !== prevReportedPercent) {
					prevReportedPercent = percent
					onProgress(percent / 100)
				}
			}
		})
	}

	return {
		execProcess,
		cancel: () => {
			// Called if the process should be cancelled

			killProcess()
			onError(new Error(`Cancelled`))
		},
	}
}
