/* eslint-disable node/no-unpublished-import, no-console */

import path from 'node:path'
import fse from 'fs-extra'
import { glob } from 'glob'

const basePath = '.'

console.log(`Cleaning up...`)

try {
	await fse.rm(path.resolve(path.join(basePath, 'tmp_packages_for_build')), {
		recursive: true,
	})
} catch (e) {
	if (`${e}`.includes('no such file or directory')) {
		// Ignore
	} else {
		throw e
	}
}

// Remove artifacts created by prepare-for-build32.js...

console.log(`Looking up copied files to remove...`)

const filesToRemove = []

async function lookupFiles(pattern) {
	console.log(`Checking ${pattern}...`)

	const files = await glob(`${basePath}/${pattern}`)
	for (const file of files) {
		filesToRemove.push(file)
	}
}

await lookupFiles(`apps/*/app/node_modules/@*/app/*`)
await lookupFiles(`apps/*/app/node_modules/@*/generic/*`)
await lookupFiles(`node_modules/@parcel/watcher/build/**/*`)

console.log(`Found ${filesToRemove.length} files to remove.`)

const activeRemovals = []

while (filesToRemove.length > 0) {
	// Remove up to 10 files at a time:
	for (let i = 0; i < 10; i++) {
		const fileToRemove = filesToRemove.shift()
		if (!fileToRemove) break

		console.log(`Removing file: "${fileToRemove}"`)
		activeRemovals.push(fse.rm(fileToRemove, { recursive: true }))
	}

	await Promise.all(activeRemovals)
	activeRemovals.length = 0
}

console.log(`...done!`)
