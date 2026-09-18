import { describe, expect, afterEach, it, beforeEach } from 'vitest'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { escapeFilePath, resolveFileWithoutExtension } from '../filePath.js'

describe('filePath', () => {
	it('checkPath', () => {
		expect(escapeFilePath('test/path')).toBe(process.platform === 'win32' ? '"test/path"' : 'test/path')
		expect(escapeFilePath('C:\\test\\path')).toBe(
			process.platform === 'win32' ? '"C:\\test\\path"' : 'C:\\test\\path'
		)
	})
})

describe('resolveFileWithoutExtension', () => {
	let tmpDir: string

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofie-filePath-test-'))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	function touch(filename: string): void {
		fs.writeFileSync(path.join(tmpDir, filename), '')
	}

	it('returns found with correct fullPath and extension for a single match', async () => {
		touch('myclip.mp4')
		const result = await resolveFileWithoutExtension(path.join(tmpDir, 'myclip'))
		expect(result).toEqual({
			result: 'found',
			fullPath: path.join(tmpDir, 'myclip.mp4'),
			extension: '.mp4',
		})
	})

	it('returns found with compound extension (e.g. .tar.gz)', async () => {
		touch('archive.tar.gz')
		const result = await resolveFileWithoutExtension(path.join(tmpDir, 'archive'))
		expect(result).toEqual({
			result: 'found',
			fullPath: path.join(tmpDir, 'archive.tar.gz'),
			extension: '.tar.gz',
		})
	})

	it('returns found when filename has no extension', async () => {
		touch('myclip')
		const result = await resolveFileWithoutExtension(path.join(tmpDir, 'myclip'))
		expect(result).toEqual({
			result: 'found',
			fullPath: path.join(tmpDir, 'myclip'),
			extension: '',
		})
	})

	it('returns found when path already includes the extension', async () => {
		touch('myclip.mp4')
		const result = await resolveFileWithoutExtension(path.join(tmpDir, 'myclip.mp4'))
		expect(result).toEqual({
			result: 'found',
			fullPath: path.join(tmpDir, 'myclip.mp4'),
			extension: '',
		})
	})

	it('returns multiple when more than one file matches', async () => {
		touch('myclip.mp4')
		touch('myclip.mov')
		const result = await resolveFileWithoutExtension(path.join(tmpDir, 'myclip'))
		expect(result.result).toBe('multiple')
		if (result.result !== 'multiple') return
		expect(result.matches).toHaveLength(2)
		expect(result.matches).toEqual(
			expect.arrayContaining([path.join(tmpDir, 'myclip.mp4'), path.join(tmpDir, 'myclip.mov')])
		)
	})

	it('returns multiple when both extensionless and extension files exist', async () => {
		touch('myclip')
		touch('myclip.mp4')
		const result = await resolveFileWithoutExtension(path.join(tmpDir, 'myclip'))
		expect(result.result).toBe('multiple')
		if (result.result !== 'multiple') return
		expect(result.matches).toHaveLength(2)
		expect(result.matches).toEqual(
			expect.arrayContaining([path.join(tmpDir, 'myclip'), path.join(tmpDir, 'myclip.mp4')])
		)
	})

	it('returns notFound when no files match', async () => {
		touch('other.mp4')
		const result = await resolveFileWithoutExtension(path.join(tmpDir, 'myclip'))
		expect(result).toEqual({ result: 'notFound' })
	})

	it('returns notFound (not error) when the directory does not exist', async () => {
		const result = await resolveFileWithoutExtension(path.join(tmpDir, 'nonexistent-subdir', 'myclip'))
		expect(result).toEqual({ result: 'notFound' })
	})

	it('does not match filenames that share the base name but have no dot separator', async () => {
		// "myclipExtra" should not match a search for "myclip"
		touch('myclipExtra.mp4')
		const result = await resolveFileWithoutExtension(path.join(tmpDir, 'myclip'))
		expect(result).toEqual({ result: 'notFound' })
	})
})
