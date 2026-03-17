module.exports = {
	roots: ['<rootDir>/src'],
	projects: ['<rootDir>'],
	preset: 'ts-jest',
	moduleFileExtensions: ['js', 'ts'],
	transform: {
		'^.+\\.(ts|tsx)$': [
			'ts-jest',
			{
				tsconfig: 'tsconfig.json',
				diagnostics: {
					ignoreCodes: [
						151002, // hybrid module kind (Node16/18/Next)
					],
				},
			},
		],
	},
	testMatch: ['**/__tests__/**/*.spec.(ts|js)'],
	testEnvironment: 'node',
	coverageThreshold: {
		global: {
			branches: 100,
			functions: 100,
			lines: 100,
			statements: 100,
		},
	},
	coverageDirectory: '<rootDir>/coverage/',
	collectCoverage: false,
	// verbose: true,
}
