import { startSingleApp } from './singleApp.js'

console.log('process started') // This is a message all Sofie processes log upon startup

startSingleApp().catch(console.error)
