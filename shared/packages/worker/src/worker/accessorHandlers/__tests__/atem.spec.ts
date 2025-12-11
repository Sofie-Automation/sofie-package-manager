import path from 'node:path'
import { copyFile, mkdtemp, readdir } from 'node:fs/promises'
import { runForEachFFMpegRelease, SamplesDir } from '../../../__tests__/ffmpegHelper'
import { rimraf } from 'rimraf'
import { tmpdir } from 'node:os'
import { ATEMAccessorHandle } from '../atem'
import { PassiveTestWorker } from './lib'
import { initializeLogger, ProcessConfig, protectString, setupLogger } from '@sofie-package-manager/api'

async function copyToTmpDir(inputFile: string): Promise<{ tmpDir: string; copiedFile: string }> {
	const tmpDir = await mkdtemp(path.join(tmpdir(), 'package-manager-atem-'))
	const copiedFile = path.join(tmpDir, 'input_file')
	await copyFile(inputFile, copiedFile)

	return { tmpDir, copiedFile }
}

const processConfig: ProcessConfig = {
	logPath: undefined,
	logLevel: undefined,
	unsafeSSL: false,
	certificates: [],
}
initializeLogger({ process: processConfig })

runForEachFFMpegRelease(() => {
	describe('name with spaces.mov', () => {
		const clipPath = path.join(SamplesDir, 'name with spaces.mov')

		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger)

		const accessor = new ATEMAccessorHandle({
			worker,
			accessor: {},
			accessorId: protectString('test-atem-accessor'),
			content: {
				onlyContainerAccess: true,
			},
			context: {
				packageContainerId: protectString('test-package-container'),
			},
			workOptions: {},
		})

		let tmpDir: string
		let copiedFile: string

		beforeEach(async () => {
			const res = await copyToTmpDir(clipPath)
			tmpDir = res.tmpDir
			copiedFile = res.copiedFile

			const dirListBefore = await readdir(tmpDir)
			expect(dirListBefore).toHaveLength(1)
		})

		afterEach(async () => {
			rimraf.sync(tmpDir)
		})

		it('createTGASequence', async () => {
			const result = await accessor.createTGASequence(copiedFile)
			expect(result).toBe('')

			const dirListAfter = await readdir(tmpDir)
			expect(dirListAfter).toHaveLength(51)
		})

		// TODO: convertFrameToRGBA

		it('convertAudio', async () => {
			const result = await accessor.convertAudio(copiedFile)
			expect(result).toBe('')

			const dirListAfter = await readdir(tmpDir)
			expect(dirListAfter).toHaveLength(2)
		})

		it('countFrames', async () => {
			const result = await accessor.countFrames(copiedFile)
			expect(result).toBe(50)
		})

		it('getStreamIndicies', async () => {
			const videoResult = await accessor.getStreamIndices(copiedFile, 'video')
			expect(videoResult).toEqual([0])

			const audioResult = await accessor.getStreamIndices(copiedFile, 'audio')
			expect(audioResult).toEqual([1])
		})
	})
})
