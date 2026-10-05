import { describe, expect, test } from 'vitest'
import { Accessor } from '../inputApi.js'

describe('inputApi', () => {
	test('checkAssertions', () => {
		// We don't have to actually test anything here,
		// if there is an issue, the assertions in in inputApi.ts will throw upon startup
		expect(Accessor.AccessType.FILE_SHARE).toBe('file_share')
	})
})
