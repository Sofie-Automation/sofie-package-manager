import { spawn } from 'child_process'
import { LoggerInstance, stringifyError, testHtmlRenderer } from '@sofie-package-manager/api'
import { testFFMpeg, testFFProbe } from '../expectationHandlers/lib/ffmpeg'

export class ExecutableDependencyHandler {
	/** Contains the result of testing the FFMpeg executable. null = all is well, otherwise contains error message */
	public testFFMpeg: null | string = 'Not initialized'
	/** Contains the result of testing the FFProbe executable. null = all is well, otherwise contains error message */
	public testFFProbe: null | string = 'Not initialized'
	/** Contains the result of testing the HTMLRenderer executable. null = all is well, otherwise contains error message */
	public testHTMLRenderer: null | string = 'Not initialized'

	private executableCheckResults: Map<
		string,
		{
			checkedAt: number // unix timestamp
			/** null if all is well, otherwise an error message */
			status: string | null
		}
	> = new Map()

	constructor(private logger: LoggerInstance) {}

	/**
	 * Returns null if all is well, otherwise an error message
	 */
	public async getExecutableStatus(executable: string): Promise<string | null> {
		// Note: This must be a synchronous check, as it might be called from places that are not async

		const exec = this.executableCheckResults.get(executable)

		if (exec) return exec.status

		// else

		// Trigger a check
		await this.checkExecutableExists(executable)

		const exec2 = this.executableCheckResults.get(executable)
		if (exec2 === undefined)
			throw new Error(`Internal Error: this.executableCheckResults is missing entry for ${executable}`)

		return exec2.status
	}

	private async checkExecutableExists(executable: string) {
		const checkedAt = this.executableCheckResults.get(executable)?.checkedAt ?? 0

		if (checkedAt < Date.now() - 3600 * 1000) {
			// Time to check:
			const status = await this.testFFExecutable(executable)
			this.executableCheckResults.set(executable, {
				checkedAt: Date.now(),
				status,
			})

			this.logger.debug(`Checking executable ${executable}, result: ${JSON.stringify(status)}`)
		}
	}

	public async checkExecutables(): Promise<void> {
		this.testFFMpeg = await testFFMpeg()
		this.testFFProbe = await testFFProbe()
		this.testHTMLRenderer = await testHtmlRenderer()
	}

	async testFFExecutable(executable: string): Promise<string | null> {
		if (executable.endsWith('.exe') && process.platform !== 'win32') {
			executable = executable.slice(0, -4) // remove .exe
		}

		return new Promise<string | null>((resolve) => {
			const execProcess = spawn(executable, ['-v'])

			// Guard against the process not exiting on its own:
			const timeout = setTimeout(() => {
				resolve(execProcess.pid ? null : 'Timed out when checking executable')
				execProcess.kill()
			}, 2000)

			execProcess.on('error', (e) => {
				clearTimeout(timeout)
				if (`${e}`.includes('ENOENT')) {
					resolve(`Executable not found: ${stringifyError(e)}`)
				} else {
					resolve(`Error checking Executable: ${stringifyError(e)}`)
				}
			})
			execProcess.on('exit', (_code) => {
				clearTimeout(timeout)
				resolve(null)
			})
		})
	}
}
