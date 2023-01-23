/* eslint-disable node/no-unpublished-import, node/no-extraneous-import, no-console */

import { promisify } from 'util'
import cp from 'child_process'
import path from 'path'
import nexe from 'nexe'
import glob0 from 'glob'
import fse from 'fs-extra'
import { createRequire } from 'module'

const exec = promisify(cp.exec)
const glob = promisify(glob0)
const require = createRequire(import.meta.url)

/*
	Due to nexe not taking into account the packages in the mono-repo, we're doing a hack,
	copying the packages into node_modules, so that nexe will include them.
*/
const basePath = process.cwd()
const packageJson = require(path.join(basePath, '/package.json'))
const outputDirectory = path.join(basePath, './deploy/')
const executableName = process.argv[2]
if (!executableName) {
	throw new Error(`Argument for the output executable file name not provided`)
}

;(async () => {
	log(`Collecting dependencies for ${packageJson.name}...`)
	// List all Lerna packages:
	const list = await exec('yarn lerna list -a --json')
	const str = list.stdout.replace(/^\$.*$/gm, '').replace(/^Done in.*$/gm, '')

	const packages = JSON.parse(str)

	await fse.mkdirp(path.join(basePath, 'node_modules'))

	// Copy the packages into node_modules:
	const copiedFolders = []
	let ps = []
	for (const package0 of packages) {
		if (package0.name.match(/boilerplate/)) continue
		if (package0.name.match(packageJson.name)) continue

		const source = path.join(`${basePath}/../../../tmp_packages_for_build/`, package0.name)
		const target = path.resolve(path.join(basePath, 'node_modules', package0.name))
		log(`  Copying: ${package0.name} to ${target}`)

		// log(`    ${source} -> ${target}`)
		ps.push(fse.copy(source, target))

		copiedFolders.push(target)
	}

	await Promise.all(ps)
	ps = []

	// Remove things that arent used, to reduce file size:
	log(`Remove unused files...`)
	const copiedFiles = [
		...(await glob(`${basePath}/node_modules/@*/app/*`)),
		...(await glob(`${basePath}/node_modules/@*/generic/*`)),
	]

	for (const file of copiedFiles) {
		if (
			// Only keep these:
			!file.match(/package.json$/) &&
			!file.match(/node_modules$/) &&
			!file.match(/dist$/)
		) {
			log(`Removing: "${file}"`)
			ps.push(fse.rm(file, { recursive: true }))
		}
	}
	await Promise.all(ps)
	ps = []

	log(`Compiling using nexe...`)

	const nexeOutputPath = path.join(outputDirectory, executableName)

	log('nexeOutputPath', nexeOutputPath)

	await nexe.compile({
		input: path.join(basePath, './dist/index.js'),
		output: nexeOutputPath,
		// build: true, //required to use patches
		targets: ['windows-x64-12.18.1'],
	})

	log(`Cleaning up...`)
	// Clean up after ourselves:
	for (const copiedFolder of copiedFolders) {
		await fse.rm(copiedFolder, { recursive: true })
	}

	log(`...done!`)
})().catch(log)

function log(...args) {
	// eslint-disable-next-line no-console
	console.log(...args)
}
