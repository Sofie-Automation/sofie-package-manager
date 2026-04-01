import type { RouterContext } from '@koa/router'
import type { DefaultContext, DefaultState } from 'koa'
import { Readable, Writable } from 'stream'

export type CTX = RouterContext<DefaultState, DefaultContext>
export type CTXPost = RouterContext<DefaultState, DefaultContext>

export async function asyncPipe(readable: Readable, writable: Writable): Promise<void> {
	return new Promise((resolve) => {
		readable.pipe(writable)
		readable.on('end', () => {
			resolve()
		})
	})
}

export function valueOrFirst(text: string | string[] | undefined): string | undefined {
	if (!text) {
		return undefined
	} else if (Array.isArray(text)) {
		return text[0]
	} else {
		return text
	}
}
