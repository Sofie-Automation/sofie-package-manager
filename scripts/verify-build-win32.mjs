/* eslint-disable node/no-unpublished-import, node/no-extraneous-import, no-console */

import childProcess from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import process from 'process'
import { promisify } from 'util'

const exec = promisify(childProcess.exec)

const expectedOutput = [
	'Initializing Package Manager (and Expectation Manager)',
	'Workforce connected',
	'Available apps',
	'worker.exe',
]

;(async () => {
	const folderPath = path.join(process.cwd(), './deploy/')
	const execPath = path.join(folderPath, 'package-manager-single-app.exe')
	try {
		const { stdout, stderr } = await exec(execPath)

		if (!expectedOutput.map((text) => stdout.includes(text)).reduce((memo, current) => memo && current, true)) {
			console.error('stdout')
			console.error(stdout)
			console.error('stderr')
			console.error(stderr)

			console.error('')
			console.error(
				JSON.stringify(
					expectedOutput.map((text) => [text, stdout.includes(text)]),
					undefined,
					2
				)
			)

			throw new Error('💣 Built executable does not seem to initialize correctly!')
		}

		console.log('🎉 Built executable seems to run fine')
	} catch (error) {
		const errorStr = `${error}`
		if (errorStr.includes('is not recognized')) {
			// Command failed: X is not recognized as an internal or external command

			console.log('Contents of deploy/ folder:')
			console.log(JSON.stringify(await fs.readdir(folderPath)))

			console.log(`Info ${execPath}:`)
			try {
				console.log(JSON.stringify(await fs.stat(execPath)))
			} catch (statError) {
				console.log(`Could not stat ${execPath}: ${statError}`)
			}
		}
		throw error
	}
})()
