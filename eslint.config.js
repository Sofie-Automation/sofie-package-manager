import { generateEslintConfig } from '@sofie-automation/code-standard-preset/eslint/main.mjs'

export default generateEslintConfig({
	testRunner: "vitest",
	ignores: ['**/dist/**/*', '**/__tests__/**/*', '**/__mocks__/**/*']
})
