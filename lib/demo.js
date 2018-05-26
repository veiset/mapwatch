// demonstrate/test a headless mapwatch-as-a-library.
//
// TODO: we should probably have proper JS bindings before actually distributing this, so callers don't ahve to wrestle with reading the logfile. something like:
// * subscribeMapRunEvents(onEvent)
// * readLogs(path, ?maxSize, ?onClose)
// * watchLogs(path, ?startAt)   
// * pushLogLine(line)      // low-level alternative to readLogs/watchLogs
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const loadedAt = Date.now()
const mapwatch = require('../dist/lib/elm').Main.worker({
  loadedAt,
  tickOffset: 0,
  isBrowserSupported: true,
  platform: 'library',
})
mapwatch.ports.mapRunEvent.subscribe(event => {
  // for this demo, simply log each event. Real library users will do something more interesting here
  console.log("new map run finished", event)
})

function readFileSlice(path_, start, end, onClose) {
  const reader = readline.createInterface({input: fs.createReadStream(path_, {start, end})})
  reader.on('line', line => {
    // console.log('line', line)
    mapwatch.ports.logline.send(line)
  })
  if (onClose) reader.on('close', onClose)
}
function watch(path_, lastSize) {
  return fs.watch(path_, () => {
    fs.stat(path_, (err, stats) => {
      // TODO real error handling
      if (err) return console.error(err)
      if (stats.size > lastSize) {
        readFileSlice(path_, lastSize, stats.size)
      }
      lastSize = stats.size
    })
  })
}
const path_ = path.join(__dirname,  "../assets/examples/stripped-client.txt")
fs.stat(path_, (err, stats) => {
  // TODO real error handling
  if (err) return console.error(err)

  console.log('started reading client.txt history')
  // if you don't care about history and want to watch for new map runs, skip the readFileSlice() and skip to watch()
  readFileSlice(path_, 0, stats.size, () => {
    console.log('started watching client.txt history')
    const watcher = watch(path_, stats.size)
  })
})