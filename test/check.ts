import { findClientEntryTrimmed, findEntryContaining } from "../src/causal-graph.js"
import { CausalGraph, LV, cgEntryRLE } from "../src/types.js"
import assert from 'node:assert/strict'
import { advanceFrontier } from "../src/utils.js"
import { assertRLEPacked } from 'rle-utils/testhelpers'
import { indexedMapRLE } from "rle-utils"

/**
 * This function checks the the internal invariants of the causal graph all
 * hold up.
 *
 * This is used for debugging.
 */
export function checkCG(cg: CausalGraph) {
  // Invariants:
  // - Every version in entries is in agentToVersion (and vice versa)
  // - Entries are sorted correctly
  // - heads points to the dominator set for the entire data structure
  // - Entries are not empty
  // - (And everything is RLE?)

  let actualHeads: LV[] = []
  let nextVersion = 0 // Versions are ordered and packed.
  for (const e of cg.entries) {
    assert.equal(e.version, nextVersion)
    assert(e.vEnd > e.version)

    for (const p of e.parents) {
      assert(p >= 0)
      assert(p < e.version)
    }

    // // Check that the entry has a reverse mapping.
    // let v = e.version
    // let seq = e.seq
    // while (true) {
    //   const [vs, ve] = pubToLVSpan(cg, e.agent, seq)
    //   assert.equal(v, vs)
    //   if (ve >= e.vEnd) break

    //   v = ve
    //   seq += ve - vs
    // }

    // Check that the entry has a reverse mapping.
    // Because the whole graph is RLE, this entry should be entirely contained
    // in a single ClientEntry.
    const ce = findClientEntryTrimmed(cg, e.agent, e.seq)
    if (ce == null) throw Error('Missing client entry')
    assert.equal(ce.val, e.version)
    assert(ce.keyEnd >= e.seq + (e.vEnd - e.version))

    nextVersion = e.vEnd
    actualHeads = advanceFrontier(actualHeads, e.vEnd - 1, e.parents)
  }

  assert.deepEqual(cg.heads, actualHeads)

  for (const agent in cg.agentToVersion) {
    let nextSeq = 0 // Sequence numbers are ordered but not packed.

    for (const ce of cg.agentToVersion[agent]) {
      assert(ce.keyStart >= nextSeq)
      nextSeq = ce.keyEnd

      assert(ce.keyEnd > ce.keyStart) // Entries must not be empty.

      // And make sure that the inverse mapping contains the version.
      let v = ce.val
      let seq = ce.keyStart
      while (true) {
        const [entry, offset] = findEntryContaining(cg, v)
        assert.equal(entry.version + offset, v)
        assert.equal(entry.agent, agent)
        assert.equal(entry.seq + offset, seq)

        if (entry.vEnd >= ce.val + (ce.keyEnd - ce.keyStart)) break

        v = entry.vEnd
        seq += entry.vEnd - entry.version
      }
    }
  }

  // Check everything is maximally RLE.
  assertRLEPacked(cg.entries, cgEntryRLE)
  for (const agent in cg.agentToVersion) {
    assertRLEPacked(cg.agentToVersion[agent], indexedMapRLE)
  }
}