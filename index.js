/**
 * This file creates an h2 server, and sends a lot of fuzzed H2 frames at it.
 * If it doesn't terminate, chances are it's hanging.
 * Note that we don't check server output, so indications of issues are limited
 * to emitted errors, hanging, and crashing.
 */

(async()=>{try{

// Specifies the path to a directory that will be scanned (recursively) for files. All of the resulting files should be test inputs.
const CORPUS_DIR = './nghttp2/fuzz/corpus'
// Specifies the path to a binary that reads input data from stdin, and writes fuzzed data to stdout
const FUZZ_BIN = './radamsa/bin/radamsa'
// Range of seeds to pass to radamsa. Each test input will be fuzzed once for each seed.
const SEED_START = 1020
const SEED_END = 1044
// If true, a number of sockets equal to the number of inputs in the corpus will be opened at the same time. Otherwise, only one is opened at a time.
const CONCURRENT = false
// Port # to listen on
const PORT = 9090

const fs = require('mz/fs')
const http2 = require('http2')
const { Socket } = require('net')
const { spawn } = require('child_process')
const concatStream = require('concat-stream')
const thenify = require('thenify')
const readdirp = thenify(require('readdirp'))

// Helper function: Given an input buffer/string, returns a Promise that resolves with the output of FUZZ_BIN when this input is piped to it
const spawnFuzzBin = (input, seed) => new Promise(resolve => {
  const cp = spawn(FUZZ_BIN, ['--seed', seed || 0], {})
  const writeable = concatStream(result => {
    if (Array.isArray(result)) {
      resolve(Buffer.alloc(0))
    } else {
      resolve(result)
    }
  })
  cp.stdio[1].pipe(writeable)
  cp.stdio[0].end(input)
})

// Create a server and listen on port PORT
const server = http2.createServer()
server.on('stream', (stream) => {
  stream.end()
})
await new Promise(resolve => server.listen(PORT, resolve))

// Read a list of all input file paths to fuzz from CORPUS_DIR, recursively,
// into corpus.
const corpus = (await readdirp({ root: CORPUS_DIR })).files.map(a => a.path)
// Queues a number of "tasks" (callbacks). Each task opens a socket for each
// input, and sends RUNS_PER_INPUT fuzzed inputs over a socket to the server.
const tasks = corpus.map(file => async () => {
  const body = await fs.readFile(`${CORPUS_DIR}/${file}`)
  // Use raw TCP socket for client-side
  for (let seed = SEED_START; seed <= SEED_END; seed++) {
    // Create a new socket
    const client = new Socket()
    // Connect to server and wait until connected
    await new Promise(resolve => client.connect({ port: server.address().port }, resolve))
    // Generate a fuzzed input
    const fuzzedBody = await spawnFuzzBin(body, seed)
    console.log(`Testing ${file} fuzzed with seed ${seed}`)
    // Send it
    client.end(fuzzedBody)
  }
})
// Run the tasks. Wait until they're all done.
if (CONCURRENT) {
  await Promise.all(tasks.map(f => f()))
} else {
  for (let i = 0; i < tasks.length; i++) {
    await tasks[i]()
  }
}
server.close()

}catch(e){console.error(e)}})()
