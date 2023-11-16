import assert from 'node:assert/strict'
import seedRandom from 'seed-random'
import consoleLib from 'console'
import { addPubVersion, createCG, lvListToPub, mergeLocalCG, nextLV, pubVersionCmp } from '../src/causal-graph.js'
import { CausalGraph, PubVersion } from '../src/types.js'
import { checkCG } from '../src/check.js'
import { fromSerialized, serialize, serializeDiff3 } from '../src/serialization.js'

function checkSerializeRoundtrips(cg: CausalGraph) {
  const serialized = serialize(cg)
  const deserialized = fromSerialized(serialized)
  assert.deepEqual(deserialized, cg)

  // The partial serialized snapshot looks identical to the simpler snapshot, but
  // with external references.
  const next = nextLV(cg)
  const partialSerialized = serializeDiff3(cg, next > 0 ? [[0, next]] : [])
  assert.deepEqual(partialSerialized.entries, serialized)
}

// This fuzzer will make 3 causal graphs, then randomly generate entries and
// merge them into each other using the serialization methods.
function fuzzer(seed: number) {
  globalThis.console = new consoleLib.Console({
    stdout: process.stdout, stderr: process.stderr,
    inspectOptions: {depth: null}
  })

  const random = seedRandom(`zz ${seed}`)
  const randInt = (n: number) => Math.floor(random() * n)

  const docs = [createCG(), createCG(), createCG()]
  const agents: PubVersion[] = [['a', 0], ['b', 0], ['c', 0]]
  const randDoc = () => docs[randInt(docs.length)]

  let nextItem = 0

  for (let i = 0; i < 100; i++) {
    // console.log('ii', i)
    // Generate some random operations
    for (let j = 0; j < 3; j++) {
      const doc = randDoc()
      let agent = agents[randInt(agents.length)]

      const len = randInt(3) + 1

      // console.log('doc', doc)
      addPubVersion(doc, agent, len)
      agent[1] += len
      // console.log('d->', doc)

      // checkCG(doc) // EXPENSIVE
      // checkSerializeRoundtrips(doc)
    }

    // Pick a random pair of documents and merge them
    const a = randDoc()
    const b = randDoc()
    if (a !== b) {
      // console.log('a', a, 'b', b)

      mergeLocalCG(a, b)
      // console.log(a)
      // debugger
      mergeLocalCG(b, a)
      // console.log(b)
      // console.log('a', a.content, 'b', b.content)
      // console.log('a', a, 'b', b)
      assert.deepEqual(
        lvListToPub(a).sort(pubVersionCmp),
        lvListToPub(b).sort(pubVersionCmp)
      )

      // Ideally we'd do a more expensive equality comparison here,
      // but if the public heads match and check() passes, this is pretty
      // thorough.
      checkCG(a)
      checkCG(b)
    }
  }

  for (const doc of docs) checkSerializeRoundtrips(doc)
}

function fuzzLots() {
  for (let i = 0; i < 100000; i++) {
    if (i % 10 === 0) console.log('i', i)
    try {
      fuzzer(i)
    } catch (e) {
      console.log('in seed', i)
      throw e
    }
  }
}

// fuzzer(Number(process.env['SEED']) ?? 0)
// fuzzer(5)
fuzzLots()