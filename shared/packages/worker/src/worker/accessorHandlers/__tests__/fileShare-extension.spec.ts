// Mock resolveFileWithoutExtension before importing modules
const mockResolveFileWithoutExtension = jest.fn()
jest.mock('@sofie-package-manager/api', () => {
	const actual = jest.requireActual('@sofie-package-manager/api')
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
import { Content, FileShareAccessorHandle } from '../fileShare'
import { PassiveTestWorker } from './lib'
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

	test('should resolve file with single extension match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		// Use platform-specific UNC path on Windows, or regular path on Unix
		const folderPath = process.platform === 'win32' 
			? '\\\\networkShare\\test\\folder'
			: path.join('networkShare', 'test', 'folder')
		const expectedPath = path.join(folderPath, 'testfile.mp4')
		const fullPathWithoutExt = path.join(folderPath, 'testfile')

		// Mock resolveFileWithoutExtension to return a single match
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'found',
			fullPath: expectedPath,
			extension: '.mp4',
		})

		const accessor = new FileShareAccessorHandle<Content>({
			worker,
			accessorId: protectString('share0'),
			accessor: {
				type: Accessor.AccessType.FILE_SHARE,
				folderPath: folderPath,
			} as AccessorOnPackage.FileShare,
			context: { expectationId: 'exp0' },
			content: { filePath: 'testfile' },
			workOptions: {},
		})

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
		expect(mockResolveFileWithoutExtension).toHaveBeenCalledWith(fullPathWithoutExt)
	})

	test('should throw error when multiple files match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		// Use platform-specific UNC path on Windows, or regular path on Unix
		const folderPath = process.platform === 'win32' 
			? '\\\\networkShare\\test\\folder'
			: path.join('networkShare', 'test', 'folder')

		// Mock resolveFileWithoutExtension to return multiple matches
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'multiple',
			matches: [
				path.join(folderPath, 'testfile.mp4'),
				path.join(folderPath, 'testfile.mov'),
				path.join(folderPath, 'testfile.avi'),
			],
		})

		const accessor = new FileShareAccessorHandle<Content>({
			worker,
			accessorId: protectString('share0'),
			accessor: {
				type: Accessor.AccessType.FILE_SHARE,
				folderPath: folderPath,
			} as AccessorOnPackage.FileShare,
			context: { expectationId: 'exp0' },
			content: { filePath: 'testfile' },
			workOptions: {},
		})

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/Multiple files found matching/)
	})

	test('should throw error when no files match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		// Use platform-specific UNC path on Windows, or regular path on Unix
		const folderPath = process.platform === 'win32' 
			? '\\\\networkShare\\test\\folder'
			: path.join('networkShare', 'test', 'folder')

		// Mock resolveFileWithoutExtension to return no matches
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'notFound',
		})

		const accessor = new FileShareAccessorHandle<Content>({
			worker,
			accessorId: protectString('share0'),
			accessor: {
				type: Accessor.AccessType.FILE_SHARE,
				folderPath: folderPath,
			} as AccessorOnPackage.FileShare,
			context: { expectationId: 'exp0' },
			content: { filePath: 'testfile' },
			workOptions: {},
		})

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/File not found/)
	})

	test('should not use extension matching when feature is disabled', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, false)

		const resolveSpy = mockResolveFileWithoutExtension

		// Use platform-specific UNC path on Windows, or regular path on Unix
		const folderPath = process.platform === 'win32' 
			? '\\\\networkShare\\test\\folder'
			: path.join('networkShare', 'test', 'folder')
		const expectedPath = path.join(folderPath, 'testfile')

		const accessor = new FileShareAccessorHandle<Content>({
			worker,
			accessorId: protectString('share0'),
			accessor: {
				type: Accessor.AccessType.FILE_SHARE,
				folderPath: folderPath,
			} as AccessorOnPackage.FileShare,
			context: { expectationId: 'exp0' },
			content: { filePath: 'testfile' },
			workOptions: {},
		})

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
		expect(resolveSpy).not.toHaveBeenCalled()
	})

	afterEach(() => {
		mockResolveFileWithoutExtension.mockReset()
	})
})
