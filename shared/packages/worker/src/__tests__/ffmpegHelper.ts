import { describe, expect, test, beforeEach, afterAll } from 'vitest'

import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { LocalFolderAccessorHandle } from '../worker/accessorHandlers/localFolder.js'
import { overrideFFMpegExecutables, spawnFFMpeg } from '../worker/workers/genericWorker/expectationHandlers/lib/ffmpeg.js'
import { ExecutableAliasSource } from '@sofie-package-manager/api'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

export const SamplesDir = path.join(__dirname, '../../../../../tests/samples')

export async function callSpawnFFmpeg(args: string[], targetHandle: LocalFolderAccessorHandle<any>): Promise<void> {
	let resolve = () => {}
	let reject = (_err: Error) => {}
	const result = new Promise<void>((resolve2, reject2) => {
		resolve = resolve2
		reject = reject2
	})

	const ffmpegProcess = await spawnFFMpeg(
		aliasSource,
		args,
		targetHandle,
		async () => resolve(),
		async (err) => reject(err)
	)
	expect(ffmpegProcess).toBeTruthy()

	// Wait for process to complete
	await result
}

export function runForEachFFMpegRelease(runForFFmpegRelease: () => void) {
	const ffprobeFilename = process.platform === 'win32' ? 'bin/ffprobe.exe' : 'ffprobe'
	const ffmpegFilename = process.platform === 'win32' ? 'bin/ffmpeg.exe' : 'ffmpeg'

	const ffmpegRootPath = path.join(__dirname, '../../../../../.ffmpeg')

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const targetVersions = require('../../../../../tests/ffmpegReleases.json')

	for (const version of targetVersions[`${process.platform}-${process.arch}`]) {
		describe(`FFmpeg ${version.id}`, () => {
			beforeEach(() => {
				overrideFFMpegExecutables({
					ffmpeg: path.join(ffmpegRootPath, version.id, ffmpegFilename),
					ffprobe: path.join(ffmpegRootPath, version.id, ffprobeFilename),
				})
			})
			afterAll(() => {
				overrideFFMpegExecutables(null)
			})

			runForFFmpegRelease()
		})
	}
}
const aliasSource: ExecutableAliasSource = {
	getExecutable: () => undefined,
}
