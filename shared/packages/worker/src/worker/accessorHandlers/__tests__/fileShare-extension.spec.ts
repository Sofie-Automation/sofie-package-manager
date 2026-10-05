import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest'

// Mock resolveFileWithoutExtension before importing modules
const mockResolveFileWithoutExtension = vi.hoisted(() => vi.fn())
const mockFsReaddir = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal() as typeof import('node:fs')
	const mockedFs = {
		...actual,
		readdir: mockFsReaddir,
	}
	return {
		...mockedFs,
		default: mockedFs,
	}
})

vi.mock('@sofie-package-manager/api', async (importOriginal) => {
	const actual = await importOriginal() as typeof import('@sofie-package-manager/api')
	return {
		...actual,
		resolveFileWithoutExtension: mockResolveFileWithoutExtension,
	}
})

import {
	AccessorOnPackage,
	protectString,
	setupLogger,
	initializeLogger,
	ProcessConfig,
	Accessor,
} from '@sofie-package-manager/api'
import { Content, FileShareAccessorHandle } from '../fileShare.js'
import { PassiveTestWorker } from './lib.js'
import path from 'node:path'

describe('matchFilenamesWithoutExtension for FileShare', () => {
	beforeAll(() => {
		initializeLogger({
			process: {
				logPath: undefined,
				logLevel: undefined,
				unsafeSSL: false,
				certificates: [],
			},
		})
	})
	const processConfig: ProcessConfig = {
		logPath: undefined,
		logLevel: undefined,
		unsafeSSL: false,
		certificates: [],
	}

	const getFolderPath = (): string => {
		return process.platform === 'win32'
			? '\\\\networkShare\\test\\folder'
			: path.join('networkShare', 'test', 'folder')
	}

	const createAccessor = (worker: PassiveTestWorker, folderPath: string, filePath = 'testfile') => {
		return new FileShareAccessorHandle<Content>({
			worker,
			accessorId: protectString('share0'),
			accessor: {
				type: Accessor.AccessType.FILE_SHARE,
				folderPath: folderPath,
			} as AccessorOnPackage.FileShare,
			context: { expectationId: 'exp0' },
			content: { filePath },
			workOptions: {},
		})
	}

	test('should resolve file with single extension match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = getFolderPath()
		const expectedPath = path.join(folderPath, 'testfile.mp4')
		const fullPathWithoutExt = path.join(folderPath, 'testfile')
		const filesInDir = ['testfile.mp4', 'other.mov']
		mockFsReaddir.mockImplementationOnce((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(null, filesInDir)
		})

		// Mock resolveFileWithoutExtension to return a single match
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'found',
			fullPath: expectedPath,
			extension: '.mp4',
		})

		const accessor = createAccessor(worker, folderPath)

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
		expect(mockResolveFileWithoutExtension).toHaveBeenCalledWith(fullPathWithoutExt, filesInDir)
	})

	test('should throw error when multiple files match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = getFolderPath()
		mockFsReaddir.mockImplementationOnce((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(null, ['testfile.mp4', 'testfile.mov', 'testfile.avi'])
		})

		// Mock resolveFileWithoutExtension to return multiple matches
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'multiple',
			matches: [
				path.join(folderPath, 'testfile.mp4'),
				path.join(folderPath, 'testfile.mov'),
				path.join(folderPath, 'testfile.avi'),
			],
		})

		const accessor = createAccessor(worker, folderPath)

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/Multiple files found matching/)
	})

	test('should throw error when no files match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = getFolderPath()
		mockFsReaddir.mockImplementationOnce((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(null, ['unrelated.mov'])
		})

		// Mock resolveFileWithoutExtension to return no matches
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'notFound',
		})

		const accessor = createAccessor(worker, folderPath)

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/File not found/)
	})

	test('should not use extension matching when feature is disabled', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, false)

		const resolveSpy = mockResolveFileWithoutExtension

		const folderPath = getFolderPath()
		const expectedPath = path.join(folderPath, 'testfile')

		const accessor = createAccessor(worker, folderPath)

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
		expect(resolveSpy).not.toHaveBeenCalled()
	})

	test('should use an empty directory listing when directory does not exist', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = getFolderPath()
		const fullPathWithoutExt = path.join(folderPath, 'testfile')
		const enoent = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
		enoent.code = 'ENOENT'
		mockFsReaddir.mockImplementationOnce((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(enoent)
		})
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'notFound',
		})

		const accessor = createAccessor(worker, folderPath)

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/File not found/)
		expect(mockResolveFileWithoutExtension).toHaveBeenCalledWith(fullPathWithoutExt, [])
	})

	test('should throw error when directory listing fails for other reasons', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = getFolderPath()
		const eacces = new Error('EACCES: permission denied') as NodeJS.ErrnoException
		eacces.code = 'EACCES'
		mockFsReaddir.mockImplementationOnce((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(eacces)
		})

		const accessor = createAccessor(worker, folderPath)

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/Error listing files in/)
		expect(mockResolveFileWithoutExtension).not.toHaveBeenCalled()
	})

	afterEach(() => {
		mockResolveFileWithoutExtension.mockReset()
		mockFsReaddir.mockReset()
	})
})
