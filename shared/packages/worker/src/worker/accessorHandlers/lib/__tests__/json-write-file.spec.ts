import { GenericFileHandler } from '../GenericFileHandler'
import { JSONWriteHandler, JSONWriteFilesLockHandler, JSONWriteFilesBestEffortHandler } from '../json-write-file'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

const logger = {
	error: jest.fn((message: string) => console.log('ERROR', message)),
	warn: jest.fn((message: string) => console.log('WARNING', message)),
	debug: jest.fn((message: string) => {
		// suppress noisy log
		if (message.includes('File is already locked')) return
		if (message.includes('File was locked by someone else')) return
		if (message.includes('Unable to parse Lock file content')) return
		console.log('DEBUG', message)
	}),
	silly: jest.fn((message: string) => console.log('SILLY', message)),
	category: () => logger,
}

const fileHandler: GenericFileHandler = {
	logOperation: (_message: string) => {},
	getFullPath: (filePath: string) => `${filePath}`,
	unlinkIfExists: async (_fullPath: string) => {
		try {
			await fs.unlink(_fullPath)
			return true
		} catch (e) {
			if ((e as any)?.code === 'ENOENT') {
				// not found, that's okay
				return false
			} else throw e
		}
	},
	getMetadataPath: (fullPath: string) => `${fullPath}.metadata`,
	fileExists: async (_fullPath: string) => {
		throw new Error('fileExists Not implemented')
	},
	readFile: async (_fullPath: string) => {
		throw new Error('readFile Not implemented')
	},
	readFileIfExists: async (fullPath: string) => {
		try {
			await fs.access(fullPath)
		} catch (e) {
			if ((e as any)?.code === 'ENOENT') {
				// not found
				return undefined
			} else throw e
		}
		return fs.readFile(fullPath)
	},
	writeFile: async (fullPath: string, content: Buffer) => {
		await fs.writeFile(fullPath, content as any)
	},
	listFilesInDir: async (_fullPath: string) => {
		throw new Error('listFilesInDir Not implemented')
	},
	removeDirIfExists: async (_fullPath: string) => {
		throw new Error('removeDirIfExists Not implemented')
	},
	rename: async (from: string, to: string) => fs.rename(from, to),
}

describe('JSONWriteFilesLockHandler', () => {
	const FILE_NAME = path.resolve('file_a.json')
	beforeEach(async () => {
		logger.error.mockClear()
		logger.warn.mockClear()
		logger.debug.mockClear()
		logger.silly.mockClear()
	})
	afterEach(async () => {
		await Promise.all([
			unlinkIfExists(FILE_NAME),
			unlinkIfExists(getLockPath(FILE_NAME)),
			unlinkIfExists(JSONWriteHandler.getTmpPath(FILE_NAME)),
		])
	})

	const writeHandler = new JSONWriteFilesLockHandler(fileHandler, logger as any)

	test('updateJSONFile: single write', async () => {
		const cbManipulate = jest.fn(() => {
			return {
				a: 1,
			}
		})

		await writeHandler.updateJSONFile(FILE_NAME, cbManipulate)

		expect(cbManipulate).toHaveBeenCalledTimes(1)
		expect(await readIfExists(FILE_NAME)).toBe(
			JSON.stringify({
				a: 1,
			})
		)
		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})

	test('updateJSONFile: 2 writes', async () => {
		const cbManipulate = jest.fn((o) => {
			o = o || []
			o.push('a')
			return o
		})

		const p0 = writeHandler.updateJSONFile(FILE_NAME, cbManipulate)
		await sleep(5)

		const p1 = writeHandler.updateJSONFile(FILE_NAME, cbManipulate)

		await Promise.all([p0, p1])

		expect(cbManipulate).toHaveBeenCalledTimes(2)
		expect(await readIfExists(FILE_NAME)).toBe(JSON.stringify(['a', 'a']))
		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})
	test('updateJSONFile: 15 writes', async () => {
		const cbManipulate = jest.fn((o) => {
			o = o || []
			o.push('b')
			return o
		})

		// This should be an impossible task, because there will be too many locks, and not enough time to resolve them:

		let error: any
		try {
			await Promise.all([
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
			])
		} catch (e) {
			error = e
		}
		expect(error + '').toMatch(/Failed to lock file/)

		// Wait for the lock functions to finish retrying:
		await sleep(writeHandler.RETRY_TIMEOUT * writeHandler.LOCK_ATTEMPTS_COUNT)

		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})

	test('updateJSONFileBatch: single write', async () => {
		const cbManipulate = jest.fn(() => {
			return {
				b: 1,
			}
		})
		await writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate)

		expect(cbManipulate).toHaveBeenCalledTimes(1)
		expect(await readIfExists(FILE_NAME)).toBe(
			JSON.stringify({
				b: 1,
			})
		)
		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})

	test('updateJSONFileBatch: 3 writes', async () => {
		const v = await readIfExists(FILE_NAME)
		expect(v).toBe(undefined)

		const cbManipulate = jest.fn((o) => {
			o = o || []
			o.push('a')
			return o
		})

		const p0 = writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate)
		await sleep(5)

		const p1 = writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate)
		const p2 = writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate)

		await Promise.all([p0, p1, p2])

		expect(cbManipulate).toHaveBeenCalledTimes(3)
		expect(await readIfExists(FILE_NAME)).toBe(JSON.stringify(['a', 'a', 'a']))

		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})
	test('updateJSONFileBatch: 20 writes', async () => {
		const cbManipulate = jest.fn((o) => {
			o = o || []
			o.push('a')
			return o
		})

		const ps: Promise<void>[] = []
		let expectResult: string[] = []
		for (let i = 0; i < 20; i++) {
			ps.push(writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate))
			expectResult.push('a')
		}

		await Promise.all(ps)

		expect(cbManipulate).toHaveBeenCalledTimes(20)
		expect(await readIfExists(FILE_NAME)).toBe(JSON.stringify(expectResult))

		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})
})

describe('JSONWriteFilesBestEffortHandler', () => {
	const FILE_NAME = path.resolve('file_b.json')
	beforeEach(async () => {
		logger.error.mockClear()
		logger.warn.mockClear()
		logger.debug.mockClear()
		logger.silly.mockClear()
	})
	afterEach(async () => {
		await Promise.all([
			unlinkIfExists(FILE_NAME),
			unlinkIfExists(getLockPath(FILE_NAME)),
			unlinkIfExists(JSONWriteHandler.getTmpPath(FILE_NAME)),
		])
	})

	const writeHandler = new JSONWriteFilesBestEffortHandler(fileHandler, logger as any)

	test('updateJSONFile: single write', async () => {
		const cbManipulate = jest.fn(() => {
			return {
				a: 1,
			}
		})

		await writeHandler.updateJSONFile(FILE_NAME, cbManipulate)

		expect(cbManipulate).toHaveBeenCalledTimes(2)
		expect(await readIfExists(FILE_NAME)).toBe(
			JSON.stringify({
				a: 1,
			})
		)
		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})

	test('updateJSONFile: 2 writes', async () => {
		const cbManipulate = jest.fn((o) => {
			o = o || []
			o.push('a')
			return o
		})

		const p0 = writeHandler.updateJSONFile(FILE_NAME, cbManipulate)
		await sleep(5)

		const p1 = writeHandler.updateJSONFile(FILE_NAME, cbManipulate)

		await Promise.all([p0, p1])

		expect(cbManipulate).toHaveBeenCalledTimes(4)
		expect(await readIfExists(FILE_NAME)).toBe(JSON.stringify(['a', 'a']))
		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})
	test('updateJSONFile: 15 writes', async () => {
		const cbManipulate = jest.fn((o) => {
			o = o || []
			o.push('b')
			return o
		})

		// This should be an impossible tasks, because there will be too many locks, and not enough time to resolve them:

		let error: any
		try {
			await Promise.all([
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
				writeHandler.updateJSONFile(FILE_NAME, cbManipulate),
			])
		} catch (e) {
			error = e
		}

		expect(error + '').toMatch(/Failed to lock file/)

		// Wait for the lock functions to finish retrying:
		await sleep(writeHandler.RETRY_TIMEOUT * writeHandler.LOCK_ATTEMPTS_COUNT)

		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})

	test('updateJSONFileBatch: single write', async () => {
		const cbManipulate = jest.fn(() => {
			return {
				b: 1,
			}
		})
		await writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate)

		expect(cbManipulate).toHaveBeenCalledTimes(2)
		expect(await readIfExists(FILE_NAME)).toBe(
			JSON.stringify({
				b: 1,
			})
		)
		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})

	test('updateJSONFileBatch: 3 writes', async () => {
		const v = await readIfExists(FILE_NAME)
		expect(v).toBe(undefined)

		const cbManipulate = jest.fn((o) => {
			o = o || []
			o.push('a')
			return o
		})

		const p0 = writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate)
		await sleep(5)

		const p1 = writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate)
		const p2 = writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate)

		await Promise.all([p0, p1, p2])

		expect(cbManipulate).toHaveBeenCalledTimes(6)
		expect(await readIfExists(FILE_NAME)).toBe(JSON.stringify(['a', 'a', 'a']))

		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})
	test('updateJSONFileBatch: 20 writes', async () => {
		const cbManipulate = jest.fn((o) => {
			o = o || []
			o.push('a')
			return o
		})

		const ps: Promise<void>[] = []
		let expectResult: string[] = []
		for (let i = 0; i < 20; i++) {
			ps.push(writeHandler.updateJSONFileBatch(FILE_NAME, cbManipulate))
			expectResult.push('a')
		}

		await Promise.all(ps)

		expect(cbManipulate).toHaveBeenCalledTimes(40)
		expect(await readIfExists(FILE_NAME)).toBe(JSON.stringify(expectResult))

		expect(logger.error).toHaveBeenCalledTimes(0)
		expect(logger.warn).toHaveBeenCalledTimes(0)
	})
})

async function readIfExists(filePath: string): Promise<string | undefined> {
	try {
		return await fs.readFile(filePath, 'utf-8')
	} catch (e) {
		if ((e as any)?.code === 'ENOENT') {
			// not found
			return undefined
		} else throw e
	}
}
async function unlinkIfExists(filePath: string): Promise<void> {
	try {
		await fs.unlink(filePath)
	} catch (e) {
		if ((e as any)?.code === 'ENOENT') {
			// not found, that's okay
		} else throw e
	}
}
function getLockPath(filePath: string): string {
	return filePath + '.lock'
}
function sleep(duration: number): Promise<void> {
	return new Promise((r) => setTimeout(r, duration))
}
