import type * as WND from 'windows-network-drive'
const wnd: any = jest.createMockFromModule('windows-network-drive')

/* eslint-disable no-console */

const DEBUG_LOG = false

const mountedDrives: { [driveLetter: string]: WND.DriveInfo } = {}

export async function unmount(driveLetter: string): Promise<void> {
	if (DEBUG_LOG) console.log('WND.unmount', driveLetter)
	delete mountedDrives[driveLetter]
}
export async function mount(path: string, driveLetter: string, _userName: string, _password: string): Promise<void> {
	if (DEBUG_LOG) console.log('WND.mount', path, driveLetter)
	mountedDrives[driveLetter] = {
		driveLetter,
		path,
		status: true,
		statusMessage: 'Mock',
	}
}

export async function list(): Promise<{ [driveLetter: string]: WND.DriveInfo }> {
	if (DEBUG_LOG) console.log('WND.list')
	return mountedDrives
}

wnd.__mountedDrives = mountedDrives
wnd.unmount = unmount
wnd.mount = mount
wnd.list = list

module.exports = wnd
