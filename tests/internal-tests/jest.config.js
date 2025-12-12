const base = require('../../jest.config.base')
const packageJson = require('./package')

module.exports = {
	...base,
	displayName: packageJson.name,
	moduleNameMapper: {
		'^node:fs$': '<rootDir>/src/__mocks__/fs.ts',
		'^node:child_process$': '<rootDir>/src/__mocks__/child_process.ts',
	},
}
