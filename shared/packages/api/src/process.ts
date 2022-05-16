import { ProcessConfig } from './config'
import fs from 'fs'
import { LoggerInstance } from './logger'

// export function setupProcess(config: ProcessConfig): void {}

export class ProcessHandler {
	public certificates: Buffer[] = []
	private logger: LoggerInstance

	constructor(logger: LoggerInstance) {
		this.logger = logger.category('ProcessHandler')
	}
	init(processConfig: ProcessConfig): void {
		if (processConfig.unsafeSSL) {
			this.logger.info('Disabling NODE_TLS_REJECT_UNAUTHORIZED, be sure to ONLY DO THIS ON A LOCAL NETWORK!')
			process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
		} else {
			// var rootCas = SSLRootCAs.create()
		}
		if (processConfig.certificates.length) {
			this.logger.info(`Loading certificates...`)
			for (const certificate of processConfig.certificates) {
				try {
					this.certificates.push(fs.readFileSync(certificate))
					this.logger.info(`Using certificate "${certificate}"`)
				} catch (error) {
					this.logger.error(`Error loading certificate "${certificate}"`, error)
				}
			}
		}
	}
}
