import { test, expect } from 'vitest'

import {
	AccessorOnPackage,
	protectString,
	setupLogger,
	initializeLogger,
	ProcessConfig,
	Expectation,
	Accessor,
} from '@sofie-package-manager/api'
import { Content, FileShareAccessorHandle } from '../fileShare.js'
import { PassiveTestWorker } from './lib.js'

const processConfig: ProcessConfig = {
	logPath: undefined,
	logLevel: undefined,
	unsafeSSL: false,
	certificates: [],
}
initializeLogger({ process: processConfig })
test('checkHandleBasic', () => {
	const logger = setupLogger(
		{
			process: processConfig,
		},
		''
	)
	const worker = new PassiveTestWorker(logger)

	function getFileShareAccessor(
		accessor: AccessorOnPackage.FileShare,
		content: Content,
		workOptions: Expectation.WorkOptions.Base &
			Expectation.WorkOptions.RemoveDelay &
			Expectation.WorkOptions.UseTemporaryFilePath = {}
	) {
		accessor.type = Accessor.AccessType.FILE_SHARE
		return new FileShareAccessorHandle({
			worker,
			accessorId: protectString('share0'),
			accessor,
			context: { expectationId: 'exp0' },
			content,
			workOptions,
		})
	}

	expect(() => getFileShareAccessor({}, {}).checkHandleBasic()).toThrow('Bad input data')

	if (process.platform !== 'win32') {
		return
	}

	// missing accessor.folderPath:
	expect(getFileShareAccessor({}, { filePath: 'amb.amp4' }).checkHandleBasic()).toMatchObject({
		success: false,
		reason: { tech: 'Folder path not set' },
	})

	// All OK:
	expect(
		getFileShareAccessor({ folderPath: '\\\\nas01\\media' }, { filePath: 'amb.amp4' }).checkHandleBasic()
	).toMatchObject({
		success: true,
	})

	// Absolute file path:
	expect(
		getFileShareAccessor({ folderPath: '\\\\nas01\\media' }, { filePath: '//secret/amb.amp4' }).checkHandleBasic()
	).toMatchObject({
		success: false,
		reason: { tech: expect.stringMatching(/File path.*absolute path/) },
	})
	expect(
		getFileShareAccessor(
			{ folderPath: '\\\\nas01\\media' },
			{ filePath: 'C:\\secret\\amb.amp4' }
		).checkHandleBasic()
	).toMatchObject({
		success: false,
		reason: { tech: expect.stringMatching(/File path.*absolute path/) },
	})

	// File path outside of folder path:
	expect(
		getFileShareAccessor({ folderPath: '//nas01/media' }, { filePath: '../secret/amb.amp4' }).checkHandleBasic()
	).toMatchObject({
		success: false,
		reason: {
			user: `File path is outside of folder path`,
			tech: expect.stringMatching(/Full path.*does not start with/),
		},
	})
})
