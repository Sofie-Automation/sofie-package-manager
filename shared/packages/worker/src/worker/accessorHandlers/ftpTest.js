const SftpClient = require('ssh2-sftp-client')
const FTP = require('basic-ftp')
const Stream = require('stream')
const fs = require('fs')

async function main() {
	// const sftp = new SftpClient()
	// await sftp.connect({
	// 	host: 'test.rebex.net',
	// 	port: '22',
	// 	username: 'demo',
	// 	password: 'password',
	// })
	// console.log('connected to sftp server')
	// console.log(await sftp.list('/'))

	const ftp = new FTP.Client()

	// await ftp.access({
	// 	host: 'ftp.scene.org',
	// 	user: 'ftp',
	// 	password: 'email@example.com',
	// 	// secure: true
	// })
	// await ftp.access({
	// 	host: 'test.rebex.net',
	// 	port: 21,
	// 	user: 'demo',
	// 	password: 'password',
	// 	secure: true,
	// })
	console.log('connecting to ftp server...')
	await ftp.access({
		host: '127.0.0.1',
		port: 21,
		user: 'johan',
		password: 'johan',
		secure: true,
		secureOptions: {
			rejectUnauthorized: false,
			// ciphers: 'TLS_AES_256_GCM_SHA384',
		},
	})
	console.log('connected to ftp server')
	// console.log(await ftp.list('/pub/example'))
	// console.log(await ftp.size('/pub/example/WinFormClient.pn0g'))
	// console.log(await ftp.features())

	// const writableStream = new Stream.Duplex()

	// writableStream.on('data', () => {
	// 	console.log('data received')
	// })
	// writableStream.on('end', () => {
	// 	console.log('stream ended')
	// })

	// const writableStream = fs.createWriteStream('./test1.png')
	// const writableStream = new Stream.Writable({
	// 	write: (data) => {
	// 		console.log('data received in writable stream', data.length)
	// 	},
	// 	final: () => {
	// 		console.log('writable stream ended')
	// 	},
	// })

	// const read = fs.createReadStream('./source.png')
	// const write = fs.createWriteStream('./target.png')
	// const write2 = fs.createWriteStream('./target2.png')

	// const [sideA, sideB] = Stream.duplexPair()
	// read.pipe(sideA)
	// sideB.pipe(write)

	// const duplex = new Stream.Duplex()
	// read.pipe(duplex)
	// duplex.pipe(write)

	// const aaa = read.pipe(write)

	// aaa.on('finish', () => {
	// 	console.log('read stream finished')
	// })

	// const [sideA, sideB] = Stream.duplexPair()

	// sideB.on('data', (data) => {
	// 	console.log('data received in sideB', data.length)
	// })
	// sideB.on('end', () => {
	// 	console.log('sideB stream ended')
	// })

	// const passThrough = new Stream.PassThrough()

	// passThrough.on('data', (data) => {
	// 	console.log('data received in sideB', data.length)
	// })
	// passThrough.on('end', () => {
	// 	console.log('sideB stream ended')
	// })

	// const writableStream = new Stream.Readable().pipe(fs.createWriteStream('./test1.png'))

	// console.log('downloading file...')
	// const pDownload = ftp.downloadTo(passThrough, '/pub/example/WinFormClient.png')

	// await pDownload
	// console.log('promise resolved')

	// await sftp.connect({
	// 	host: 'ftp.scene.org',
	// 	port: 21,
	// 	username: 'ftp',
	// 	password: 'email@example.com',
	// })
	// console.log('connected to ftp server')

	// })
	// .then((data) => {
	//     console.log(data, 'the data info')
	// })
	// .catch((err) => {
	//     console.log(err, 'catch error')
	// })

	// console.log(await ftp.remove('/asdf.txt'))
	console.log(await ftp.list('/'))
}
main().catch(console.error)
