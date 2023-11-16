import { CGEntry, ClientEntry, cgEntryRLE, clientEntryRLE } from '../src/types.js';
import { testRLEMethods } from 'rle-utils/testhelpers'

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
