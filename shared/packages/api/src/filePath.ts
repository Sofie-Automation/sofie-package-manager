import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const fsReaddir = promisify(fs.readdir)

/**
 * Escape file path with double quotes on Windows.
 * This is to be used when creating process arguments, to avoid issues with spaces in file paths.
 *
 * @param {string} path File path to be escaped.
 * @returns {string} Escaped file path.
 * @see {@link https://ffmpeg.org/ffmpeg-utils.html#Quoting-and-escaping}
 */
export function escapeFilePath(path: string): string {
	if (path === '-') return path
	return process.platform === 'win32' ? `"${path}"` : path
}

export type FileResolutionResult =
	| {
			result: 'found'
			fullPath: string
			extension: string
	  }
	| {
			result: 'notFound'
	  }
	| {
			result: 'multiple'
			matches: string[]
	  }
	| {
			result: 'error'
			error: unknown
	  }

/**
 * Attempts to resolve a file path by matching filenames without extensions.
 * If the exact path doesn't exist, searches for files that start with the base name
 * followed by a dot and any extension.
 *
 * @param fullPath - The full path to the file to resolve
 * @returns A FileResolutionResult indicating whether the file was found, not found, had multiple matches, or encountered an error
 *
 * @example
 * // If looking for /path/to/file and file.mp4 exists:
 * const result = await resolveFileWithoutExtension('/path/to/file')
 * // Returns: { result: 'found', fullPath: '/path/to/file.mp4', extension: '.mp4' }
 *
 * @example
 * // If looking for /path/to/file and file.tar.gz exists:
 * const result = await resolveFileWithoutExtension('/path/to/file')
 * // Returns: { result: 'found', fullPath: '/path/to/file.tar.gz', extension: '.tar.gz' }
 *
 * @example
 * // If both file.mp4 and file.mov exist:
 * const result = await resolveFileWithoutExtension('/path/to/file')
 * // Returns: { result: 'multiple', matches: ['/path/to/file.mp4', '/path/to/file.mov'] }
 */
export async function resolveFileWithoutExtension(fullPath: string): Promise<FileResolutionResult> {
	const dir = path.dirname(fullPath)
	const base = path.basename(fullPath)

	try {
		const files = await fsReaddir(dir)
		const matches = files.filter((f) => f.startsWith(base + '.'))

		if (matches.length === 0) {
			return { result: 'notFound' }
		} else if (matches.length === 1) {
			const matchedFile = matches[0]
			const extension = matchedFile.slice(base.length) // Gets the full extension relative to the search base
			return {
				result: 'found',
				fullPath: path.join(dir, matchedFile),
				extension,
			}
		} else {
			return {
				result: 'multiple',
				matches: matches.map((f) => path.join(dir, f)),
			}
		}
	} catch (error) {
		return { result: 'error', error }
	}
}
