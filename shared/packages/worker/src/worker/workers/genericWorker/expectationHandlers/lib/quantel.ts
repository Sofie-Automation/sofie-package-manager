import { AccessorId, Expectation, literal, protectString } from '@sofie-package-manager/api'

import { Accessor, AccessorOnPackage } from '@sofie-automation/shared-lib/dist/package-manager/package'

import { getAccessorHandle, isHTTPProxyAccessorHandle } from '../../../../accessorHandlers/accessor.js'
import { GenericAccessorHandle } from '../../../../accessorHandlers/genericHandle.js'
import { HTTPProxyAccessorHandle } from '../../../../accessorHandlers/httpProxy.js'
import { BaseWorker } from '../../../../worker.js'

export function getSourceHTTPHandle(
	worker: BaseWorker,
	expectationId: string,
	sourceHandle: GenericAccessorHandle<any>,
	thumbnailURL: { baseURL: string; url: string }
): HTTPProxyAccessorHandle<any> {
	// This is a bit special, as we use the Quantel HTTP-transformer to extract the thumbnail,
	// so we have a QUANTEL source, but we construct an HTTP source from it to use instead:

	const handle = getAccessorHandle<QuantelClipMetadata>(
		worker,
		protectString<AccessorId>(sourceHandle.accessorId + '__http'),
		literal<AccessorOnPackage.HTTPProxy>({
			type: Accessor.AccessType.HTTP_PROXY,
			baseUrl: thumbnailURL.baseURL,
			// networkId?: string
			url: thumbnailURL.url,
		}),
		{ expectationId },
		{ filePath: thumbnailURL.url },
		{}
	)
	if (!isHTTPProxyAccessorHandle(handle)) throw new Error(`getSourceHTTPHandle: got a non-HTTP handle!`)
	return handle
}

export interface QuantelClipMetadata {
	sourceVersionHash: string
	version: Expectation.Version.QuantelClipThumbnail
}
