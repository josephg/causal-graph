import assert from 'node:assert/strict'
import { SimpleKeyedRLESpan, cloneItem, rleIterRange, rlePush, simpleKeyedSpanMethods, simpleRLESpanMethods } from '../src/rlelist.js';
import { CGEntry, ClientEntry, LVRange, MergeMethods, SplitMethods, cgEntryRLE, clientEntryRLE } from '../src/types.js';


// Taken from rust code.
export function testRLEMethods<T>(entry: T, m: SplitMethods<T> & MergeMethods<T>) {
  assert(m.len(entry) >= 2, "Call this with a larger entry");
  // dbg!(&entry);

  for (let i = 1; i < m.len(entry); i++) {
      // Split here and make sure we get the expected results.
      let start = cloneItem(entry, m)
      let end = m.truncate(start, i)
      // dbg!(&start, &end)

      assert.equal(m.len(start), i)
      assert.equal(m.len(end), m.len(entry) - i)

      // dbg!(&start, &end)
      const merge_append = cloneItem(start, m)
      assert(m.tryAppend(merge_append, end))

      // dbg!(&merge_append)
      assert.deepEqual(merge_append, entry)

      // let mut merge_prepend = end.clone()
      // merge_prepend.prepend(start.clone())
      // assert.equal(merge_prepend, entry)

      // Split using truncate_keeping_right. We should get the same behaviour.
      // let mut end2 = entry.clone()
      // let start2 = end2.truncate_keeping_right_ctx(i, ctx)
      // assert.equal(end2, end)
      // assert.equal(start2, start)
    }
}

{
  testRLEMethods({ length: 10, val: 'hi' }, simpleRLESpanMethods)
  testRLEMethods({ length: 10, val: 'hi', key: 100 }, simpleKeyedSpanMethods)

  {
    const list: SimpleKeyedRLESpan<string>[] = []
    rlePush(list, simpleKeyedSpanMethods, {key: 10, length: 2, val: 'a'})
    rlePush(list, simpleKeyedSpanMethods, {key: 12, length: 2, val: 'a'})
    assert(list.length === 1)
    assert(list[0].length === 4)
  }

  {
    const list: SimpleKeyedRLESpan<string>[] = []

    const empty = [...rleIterRange(list, simpleKeyedSpanMethods, 11, 13)]
    assert(empty.length === 0)

    rlePush(list, simpleKeyedSpanMethods, {key: 10, length: 2, val: 'a'})
    rlePush(list, simpleKeyedSpanMethods, {key: 12, length: 2, val: 'b'})
    const iterResult1 = [...rleIterRange(list, simpleKeyedSpanMethods, 11, 13)]
    assert.deepEqual(iterResult1, [
      {key: 11, length: 1, val: 'a'},
      {key: 12, length: 1, val: 'b'}
    ])

    assert.deepEqual([...rleIterRange(list, simpleKeyedSpanMethods, 5, 12)], [
      {key: 10, length: 2, val: 'a'}
    ])
    assert.deepEqual([...rleIterRange(list, simpleKeyedSpanMethods, 10, 12)], [
      {key: 10, length: 2, val: 'a'}
    ])
    assert.deepEqual([...rleIterRange(list, simpleKeyedSpanMethods, 0, 10000)], [
      {key: 10, length: 2, val: 'a'},
      {key: 12, length: 2, val: 'b'}
    ])
  }
}


testRLEMethods(<CGEntry>{
  version: 100,
  vEnd: 110,
  agent: 'stephen',
  seq: 20, // seq 20-30.
  parents: [1, 2, 3]
}, cgEntryRLE)

testRLEMethods(<ClientEntry>{
  seq: 20,
  seqEnd: 30,
  version: 100, // version 100-110.
}, clientEntryRLE)
