import fs from 'fs/promises'

async function main() {
	const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'))
	const libStr = `// ****** This file is generated at build-time by scripts/prebuild.js ******
/**
 * The version of the package.json file
 */
export const PACKAGE_JSON_VERSION = '${packageJson.version}'
`

	await fs.writeFile('src/packageVersion.ts', libStr, 'utf8')
}

await main()
