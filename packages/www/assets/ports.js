function parseQS(search) {
  var qs = (search||'').split('?')[1]
  var pairs = (qs||'').split('&')
  var ret = {}
  for (var i=0; i<pairs.length; i++) {
    var pair = pairs[i].split('=')
    ret[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1])
  }
  return ret
}
var qs = parseQS(document.location.search)
var loadedAt = Date.now()
var tickStart = qs.tickStart && new Date(isNaN(parseInt(qs.tickStart)) ? qs.tickStart : parseInt(qs.tickStart))
var tickOffset = qs.tickOffset || tickStart ? loadedAt - tickStart.getTime() : 0
if (tickOffset) console.log('tickOffset set:', {tickOffset: tickOffset, tickStart: tickStart})
var app = Elm.Main.fullscreen({
  loadedAt: loadedAt,
  tickOffset: tickOffset,
  isBrowserSupported: !!window.FileReader,
  // isBrowserSupported: false,
  platform: 'www',
})

if (qs.example) {
  console.log("fetching example file: ", qs.example, qs)
  // show a progress spinner, even when we don't know the size yet
  var sendProgress = progressSender(loadedAt, "history:example")(0, 0, loadedAt)
  fetch("./examples/"+qs.example)
  .then(function(res) {
    if (res.status < 200 || res.status >= 300) {
      return Promise.reject("non-200 status: "+res.status)
    }
    return res.blob()
  })
  .then(function(blob) {
    processFile(blob, blob, "history:example")
  })
  .catch(function(err) {
    console.error("Example-fetch error:", err)
  })
}

// Read client.txt line-by-line, and send it to Elm.
// Why aren't we doing the line-by-line logic in Elm? - because this used to be
// a websocket-server, and might be one again in the future.

function readFile(file, fn) {
  var reader = new FileReader()
  reader.onload = function(e) {
    fn(e.target.result, e)
  }
  reader.readAsText(file, 'utf8')
}
function LineBuffer(onLine, onDone) {
  return {
    buf: "",
    push: function(txt) {
      var buf = this.buf + txt
      var lines = buf.split(/\r?\n/)
      var i=0
      // all but the last line
      while (i < lines.length-1) {
        onLine(lines[i])
        i++
      }
      this.buf = lines[i]
    },
    done: function() {
      if (onDone) onDone(this.buf)
    }
  }
}
var MB = Math.pow(2,20)
// read line-by-line.
function readLines(file, config) {
  var chunkSize = config.chunkSize || 1*MB
  var chunkNum = 0
  var buf = LineBuffer(config.onLine, config.onDone)
  var loop = function(chunkNum) {
    var start = chunkSize * chunkNum
    var end = start + chunkSize
    var slice = file.slice(start, end)
    readFile(slice, function(txt) {
      // console.log('read chunk:', txt.length)
      buf.push(txt)
      if (config.onChunk) config.onChunk(Math.min(end, file.size), file.size, Date.now())
      if (end < file.size) {
        // window.setTimeout(function(){loop(chunkNum+1)}, 1000)
        loop(chunkNum + 1)
      }
      else {
        buf.done()
      }
    })
  }
  loop(0)
}
var filter = /Connecting to instance server|: You have entered|LOG FILE OPENING|你已進入：/
// ignore chat messages, don't want people injecting commands.
// #global, %party, @whisper, $trade, &guild
// TODO: local has no prefix! `[A-Za-z_\-]+:` might work, needs more testing
var blacklist = /] [#%@$&]/
function sendLine(line) {
  if (filter.test(line) && !blacklist.test(line)) {
    // console.log('line: ', line)
    app.ports.logline.send(line)
  }
}
function progressSender(startedAt, name) {
  return function (val, max, updatedAt) {
    app.ports.progress.send({name: name, val: val, max: max, startedAt: startedAt, updatedAt: updatedAt})
  }
}
var watcher = null
var POLL_INTERVAL = 1000
// The HTML file api doesn't seem to have a way to notify me when the file changes.
// We can poll for changes with no user interaction, though!
function watchChanges(file) {
  var startSize = file.size
  watcher = setInterval(function() {
    if (startSize !== file.size) {
      console.log("Logfile updated:", startSize, "to", file.size)
      if (startSize > file.size) {
        console.error("Logfile shrank? I'm confused, I quit")
        if (watcher) clearInterval(watcher)
      }
      else {
        processFile(file.slice(startSize), file, "watch")
      }
    }
  }, POLL_INTERVAL)
}

function processFile(fileSlice, watchedFile, progressName) {
  if (watcher) clearInterval(watcher)
  var sendProgress = progressSender(Date.now(), progressName)
  // sendProgress(0, fileSlice.size, Date.now())
  readLines(fileSlice, {onLine: sendLine, onChunk: sendProgress, onDone: function(tail) {
    sendLine(tail)
    watchChanges(watchedFile)
  }})
}
app.ports.inputClientLogWithId.subscribe(function(config) {
  var files = document.getElementById(config.id).files
  var maxSize = (config.maxSize == null ? 20 : config.maxSize) * MB
  if (files.length > 0) {
    processFile(files[0].slice(Math.max(0, files[0].size - maxSize)), files[0], "history")
  }
})

function gaEvent(action, props) {
  // because I keep messing these two up, but analytics shouldn't break prod
  if (props.category) console.warn('ports.gaEvent: category should be event_category. '+JSON.stringify(props))
  if (props.label) console.warn('ports.gaEvent: label should be event_label. '+JSON.stringify(props))

  console.log('gaEvent', action, props)
  gtag('event', action, props)
}
var isWatching = false
var historyStats = {instanceJoins: 0, mapRuns: 0}
app.ports.events.subscribe(function(event) {
  if (event.type === 'progressComplete') {
    if (!isWatching) {
      if (event.name === 'history' || event.name === 'history:example') {
        gaEvent('completed', {event_category: event.name})
        gaEvent('completed_stats', {event_category: event.name, event_label: 'instanceJoins', value: historyStats.instanceJoins})
        gaEvent('completed_stats', {event_category: event.name, event_label: 'mapRuns', value: historyStats.mapRuns})
        isWatching = true
      }
    }
  }
  else if (event.type === 'joinInstance') {
    if (!isWatching) {
      historyStats.instanceJoins += 1
      if (event.lastMapRun) {
        historyStats.mapRuns += 1
      }
    }
    else {
      gaEvent('join', {event_category: 'Instance', event_label: event.instance ? event.instance.zone : "MainMenu"})
      if (event.lastMapRun) {
        gaEvent('finish', {
          event_category: 'MapRun',
          event_label: event.lastMapRun.instance.zone,
          value: Math.floor((event.lastMapRun.leftAt - event.lastMapRun.joinedAt)/1000),
        })
      }
    }
  }
})
