import { describe, expect, vi, it } from 'vitest'

import { tmpdir } from 'os'
import path from 'path'
import { stat as fsStat, unlink as fsUnlink } from 'fs/promises'
import { LocalFolderAccessorHandle } from '../../../../accessorHandlers/localFolder.js'
import {
	FFProbeScanResult,
	scanFieldOrder,
	scanLoudness,
	scanMoreInfo,
	ScanMoreInfoResult,
	scanWithFFProbe,
} from '../lib/scan.js'
import { ExecutableAliasSource, Expectation, literal, LoggerInstance } from '@sofie-package-manager/api'
import { LoudnessScanResult } from '../lib/coreApi.js'
import { previewFFMpegArguments, thumbnailFFMpegArguments } from '../lib.js'
import { callSpawnFFmpeg, runForEachFFMpegRelease, SamplesDir } from '../../../../../__tests__/ffmpegHelper.js'

function createLocalFolderAccessorHandleMock(fullPath: string): LocalFolderAccessorHandle<any> {
	return {
		type: LocalFolderAccessorHandle.type,
		fullPath: fullPath,
		filePath: path.basename(fullPath),
		getResolvedFullPath: async () => fullPath,
	} as any
}

runForEachFFMpegRelease(() => {
	describe('name with spaces.mov', () => {
		const clipPath = path.join(SamplesDir, 'name with spaces.mov')
		const fileHandleMock = createLocalFolderAccessorHandleMock(clipPath)

		it('ffprobe scan', async () => {
			const probeResult = await scanWithFFProbe(aliasSource, fileHandleMock)
			expect(probeResult).toMatchObject(
				literal<FFProbeScanResult>({
					filePath: expect.anything(),
					format: {
						duration: '2.000000',
					},
					streams: [
						{
							index: 0,
							codec_type: 'video',
						},
						{
							index: 1,
							codec_type: 'audio',
						},
						{
							index: 2,
							codec_type: 'data',
						},
					],
				})
			)
		})

		it('field order', async () => {
			const targetVersion: Expectation.PackageDeepScan['endRequirement']['version'] = {
				fieldOrder: true,
			}

			const fieldOrder = await scanFieldOrder(aliasSource, fileHandleMock, targetVersion)
			expect(fieldOrder).toBe('progressive')
		})

		it('field order: disabled', async () => {
			const targetVersion: Expectation.PackageDeepScan['endRequirement']['version'] = {
				fieldOrder: false,
			}

			const fieldOrder = await scanFieldOrder(aliasSource, fileHandleMock, targetVersion)
			expect(fieldOrder).toBe('unknown')
		})

		it('loudness', async () => {
			const targetVersion: Expectation.PackageLoudnessScan['endRequirement']['version'] = {
				channels: ['0'],
				inPhaseDifference: true,
				balanceDifference: true,
			}

			const fakeFFProbeScanResult = null as any as FFProbeScanResult // This is not used
			const onProgress = vi.fn()

			const loudness = await scanLoudness(
				aliasSource,
				fileHandleMock,
				fakeFFProbeScanResult,
				targetVersion,
				onProgress
			)
			expect(loudness).toEqual(
				literal<LoudnessScanResult>({
					channels: {
						'0': {
							success: true,
							balanceDifference: -0.6999999999999993,
							inPhaseDifference: -0.8000000000000007,
							integrated: -15,
							integratedThreshold: -25,
							layout: 'stereo',
							range: 0,
							rangeHigh: 0,
							rangeLow: 0,
							rangeThreshold: 0,
							truePeak: -13.6,
						},
					},
				})
			)

			expect(onProgress).toHaveBeenCalled()
		})

		it('scan more', async () => {
			const onProgress = vi.fn()

			const targetVersion: Expectation.PackageDeepScan['endRequirement']['version'] = {
				scenes: true,
				freezeDetection: true,
				blackDetection: true,
			}

			const logger = {
				error: vi.fn((...args) => console.log(...args)),
				warn: vi.fn((...args) => console.log(...args)),
				help: vi.fn((...args) => console.log(...args)),
				data: vi.fn((...args) => console.log(...args)),
				info: vi.fn((...args) => console.log(...args)),
				debug: vi.fn((...args) => console.log(...args)),
				prompt: vi.fn((...args) => console.log(...args)),
				http: vi.fn((...args) => console.log(...args)),
				verbose: vi.fn((...args) => console.log(...args)),
				input: vi.fn((...args) => console.log(...args)),
				silly: vi.fn((...args) => console.log(...args)),
			} as any as LoggerInstance

			const probeResult = await scanWithFFProbe(aliasSource, fileHandleMock)
			const scanInfo = await scanMoreInfo(
				aliasSource,
				fileHandleMock,
				probeResult,
				targetVersion,
				onProgress,
				logger
			)

			expect(scanInfo).toEqual(
				literal<ScanMoreInfoResult>({
					scenes: [],
					freezes: [],
					blacks: [],
				})
			)

			// expect(onProgress).toHaveBeenCalled()
		})

		it('generate thumbnail', async () => {
			const outputPath = path.join(tmpdir(), Date.now() + '.jpg')

			try {
				const metadata = {
					version: {
						width: 160,
						height: 90,
					},
				}
				const args = thumbnailFFMpegArguments(clipPath, metadata, undefined, true)

				const targetHandle = createLocalFolderAccessorHandleMock(outputPath)

				await callSpawnFFmpeg(args, targetHandle)

				const fileStat = await fsStat(outputPath)
				expect(fileStat.isFile()).toBeTruthy()
			} finally {
				await fsUnlink(outputPath).catch(() => null)
			}
		})

		it('generate preview', async () => {
			const outputPath = path.join(tmpdir(), Date.now() + '.jpg')

			try {
				const metadata = {
					version: {
						bitrate: '50k',
						height: 160,
						width: 90,
					},
				}
				const args = previewFFMpegArguments(clipPath, false, metadata)

				const targetHandle = createLocalFolderAccessorHandleMock(outputPath)

				await callSpawnFFmpeg(args, targetHandle)

				const fileStat = await fsStat(outputPath)
				expect(fileStat.isFile()).toBeTruthy()
			} finally {
				await fsUnlink(outputPath).catch(() => null)
			}
		})
	})
})
const aliasSource: ExecutableAliasSource = {
	getExecutable: () => undefined,
}
