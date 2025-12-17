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
import { Content, LocalFolderAccessorHandle } from '../localFolder'
import { PassiveTestWorker } from './lib'
import path from 'node:path'

describe('matchFilenamesWithoutExtension for LocalFolder', () => {
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

		const folderPath = path.join('test', 'folder')
		const expectedPath = path.join(folderPath, 'testfile.mp4')
		const fullPathWithoutExt = path.join(folderPath, 'testfile')

		// Mock resolveFileWithoutExtension to return a single match
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'found',
			fullPath: expectedPath,
			extension: '.mp4',
		})

		const accessor = new LocalFolderAccessorHandle<Content>({
			worker,
			accessorId: protectString('local0'),
			accessor: {
				type: Accessor.AccessType.LOCAL_FOLDER,
				folderPath: folderPath,
			} as AccessorOnPackage.LocalFolder,
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

		const folderPath = path.join('test', 'folder')

		// Mock resolveFileWithoutExtension to return multiple matches
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'multiple',
			matches: [
				path.join(folderPath, 'testfile.mp4'),
				path.join(folderPath, 'testfile.mov'),
				path.join(folderPath, 'testfile.avi'),
			],
		})

		const accessor = new LocalFolderAccessorHandle<Content>({
			worker,
			accessorId: protectString('local0'),
			accessor: {
				type: Accessor.AccessType.LOCAL_FOLDER,
				folderPath: folderPath,
			} as AccessorOnPackage.LocalFolder,
			context: { expectationId: 'exp0' },
			content: { filePath: 'testfile' },
			workOptions: {},
		})

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/Multiple files found matching/)
	})

	test('should throw error when no files match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')

		// Mock resolveFileWithoutExtension to return no matches
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'notFound',
		})

		const accessor = new LocalFolderAccessorHandle<Content>({
			worker,
			accessorId: protectString('local0'),
			accessor: {
				type: Accessor.AccessType.LOCAL_FOLDER,
				folderPath: folderPath,
			} as AccessorOnPackage.LocalFolder,
			context: { expectationId: 'exp0' },
			content: { filePath: 'testfile' },
			workOptions: {},
		})

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/File not found/)
	})

	test('should resolve file with compound extension', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')
		const expectedPath = path.join(folderPath, 'archive.tar.gz')

		// Mock resolveFileWithoutExtension to return a compound extension match
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'found',
			fullPath: expectedPath,
			extension: '.tar.gz',
		})

		const accessor = new LocalFolderAccessorHandle<Content>({
			worker,
			accessorId: protectString('local0'),
			accessor: {
				type: Accessor.AccessType.LOCAL_FOLDER,
				folderPath: folderPath,
			} as AccessorOnPackage.LocalFolder,
			context: { expectationId: 'exp0' },
			content: { filePath: 'archive' },
			workOptions: {},
		})

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
	})

	test('should not use extension matching when feature is disabled', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, false)

		const resolveSpy = mockResolveFileWithoutExtension

		const folderPath = path.join('test', 'folder')
		const expectedPath = path.join(folderPath, 'testfile')

		const accessor = new LocalFolderAccessorHandle<Content>({
			worker,
			accessorId: protectString('local0'),
			accessor: {
				type: Accessor.AccessType.LOCAL_FOLDER,
				folderPath: folderPath,
			} as AccessorOnPackage.LocalFolder,
			context: { expectationId: 'exp0' },
			content: { filePath: 'testfile' },
			workOptions: {},
		})

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
		expect(resolveSpy).not.toHaveBeenCalled()
	})

	test('should handle directory read errors', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')

		// Mock resolveFileWithoutExtension to return an error
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'error',
			error: new Error('EACCES: permission denied'),
		})

		const accessor = new LocalFolderAccessorHandle<Content>({
			worker,
			accessorId: protectString('local0'),
			accessor: {
				type: Accessor.AccessType.LOCAL_FOLDER,
				folderPath: folderPath,
			} as AccessorOnPackage.LocalFolder,
			context: { expectationId: 'exp0' },
			content: { filePath: 'testfile' },
			workOptions: {},
		})

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/Error resolving file/)
	})

	afterEach(() => {
		mockResolveFileWithoutExtension.mockReset()
	})
})
