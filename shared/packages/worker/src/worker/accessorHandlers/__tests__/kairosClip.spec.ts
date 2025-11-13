import {
	AccessorOnPackage,
	protectString,
	setupLogger,
	initializeLogger,
	ProcessConfig,
	Expectation,
	Accessor,
} from '@sofie-package-manager/api'
import { Content, KairosClipAccessorHandle } from '../kairosClip'
import { PassiveTestWorker } from './lib'
import { refMediaRamRec, refMediaStill } from 'kairos-connection'

const processConfig: ProcessConfig = {
	logPath: undefined,
	logLevel: undefined,
	unsafeSSL: false,
	certificates: [],
}
const REF_STILL = refMediaStill(['myStill'])
const REF_RAMREC = refMediaRamRec(['myRamrec'])
initializeLogger({ process: processConfig })
test('checkHandleBasic', () => {
	const logger = setupLogger(
		{
			process: processConfig,
		},
		''
	)
	const worker = new PassiveTestWorker(logger)

	function getKairosAccessor(accessor: AccessorOnPackage.KairosClip, content: Content) {
		accessor.type = Accessor.AccessType.KAIROS_CLIP
		return new KairosClipAccessorHandle({
			worker,
			accessorId: protectString('kairos0'),
			accessor,
			context: { expectationId: 'exp0' },
			content,
			workOptions: {},
		})
	}

	//
	expect(() => getKairosAccessor({}, {}).checkHandleBasic()).toThrow('KairosClipAccessor: ref not set!')

	// All OK:
	expect(getKairosAccessor({}, { ref: REF_RAMREC }).checkHandleBasic()).toMatchObject({
		success: true,
	})
})
