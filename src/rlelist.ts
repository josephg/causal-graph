import bs from './binary-search.js'
import { assert } from './utils.js'
import { AllRLEMethods, CommonMethods, Keyed, LVRange, MergeMethods, SplitMethods } from './types.js'

// export const pushRLEList = <T>(list: T[], newItem: T, tryAppend: (a: T, b: T) => boolean) => {
//   if (list.length === 0 || !tryAppend(list[list.length - 1], newItem)) {
//     list.push(newItem)
//   }
// }

// // This is a variant of pushRLEList when we aren't sure if the new item will actually
// // be appended to the end of the list, or go in the middle!
// export const insertRLEList = <T>(list: T[], newItem: T, getKey: (e: T) => number, tryAppend: (a: T, b: T) => boolean) => {
//   const newKey = getKey(newItem)
//   if (list.length === 0 || newKey >= getKey(list[list.length - 1])) {
//     // Common case. Just push the new entry to the end of the list like normal.
//     pushRLEList(list, newItem, tryAppend)
//   } else {
//     // We need to splice the new entry in. Find the index of the previous entry...
//     let idx = bs(list, newKey, (entry, needle) => getKey(entry) - needle)
//     if (idx >= 0) throw Error('Invalid state - item already exists')

//     idx = - idx - 1 // The destination index is the 2s compliment of the returned index.

//     // Try to append.
//     if (idx === 0 || !tryAppend(list[idx - 1], newItem)) {
//       // No good! Splice in.
//       list.splice(idx, 0, newItem)
//     }
//   }
// }

export const rangeRLE: MergeMethods<LVRange> = {
  len: (item) => item[1] - item[0],
  tryAppend(r1, r2) {
    if (r1[1] === r2[0]) {
      r1[1] = r2[1]
      return true
    } else return false
  },
}

export const revRangeRLE: MergeMethods<LVRange> = {
  len: (item) => item[1] - item[0],
  tryAppend(r1, r2) {
    if (r1[0] === r2[1]) {
      r1[0] = r2[0]
      return true
    } else return false
  },
}

// export const tryRangeAppend = (r1: LVRange, r2: LVRange): boolean => {
//   if (r1[1] === r2[0]) {
//     r1[1] = r2[1]
//     return true
//   } else return false
// }

// export const tryRevRangeAppend = (r1: LVRange, r2: LVRange): boolean => {
//   if (r1[0] === r2[1]) {
//     r1[0] = r2[0]
//     return true
//   } else return false
// }


// /**
//  * An RleList is a list of items which automatically merges
//  * adjacent elements whenever possible.
//  */
// export interface RleList<T> {
//   list: T[],
//   methods: MergeAndSplitMethods<T>,
// }


export function rlePush<T>(list: T[], m: MergeMethods<T>, newItem: T) {
  if (list.length === 0 || !m.tryAppend(list[list.length - 1], newItem)) {
    list.push(newItem)
  }
}

/** Insert the new item in its corresponding location in the list */
export function rleInsert<T>(list: T[], m: MergeMethods<T> & Keyed<T>, newItem: T) {
  const {getKey} = m
  if (getKey == null) throw Error('Cannot insert with no getKey method')

  const newKey = getKey(newItem)
  if (list.length === 0 || newKey >= getKey(list[list.length - 1])) {
    // Just push the new entry to the end of the list like normal.
    rlePush(list, m, newItem)
  } else {
    // We need to splice the new entry in. Find the index of the previous entry...
    let idx = bs(list, newKey, (entry, needle) => getKey(entry) - needle)
    if (idx >= 0) throw Error('Invalid state - item already exists')

    idx = - idx - 1 // The destination index is the 2s compliment of the returned index.

    // Try to append it to the previous item.
    if (idx > 0 && m.tryAppend(list[idx - 1], newItem)) return // yey

    // That didn't work! Try to prepend it to the next item.
    if (idx < list.length - 1 && m.tryAppend(newItem, list[idx])) {
      // We've modified newItem to include list[idx].
      list[idx] = newItem
      return
    }

    // Failing all that, just splice it in.
    list.splice(idx, 0, newItem)
  }
}

export const cloneItem = <T>(item: T, m: CommonMethods<T>): T => (
  m.cloneItem?.(item) ?? {...item}
)

/** Iterate (and yield) the items in the half-open range from [startKey..endKey) */
export function *rleIterRange<T>(list: T[], m: SplitMethods<T> & Keyed<T>, startKey: number, endKey: number) {
  if (startKey === endKey) return

  const {getKey, truncate} = m
  if (getKey == null || truncate == null) throw Error('Cannot insert with no getKey method')

  let idx = bs(list, startKey, (entry, needle) => {
    const key = getKey(entry)
    return (needle >= key && needle < key + m.len(entry))
      ? 0 // Return 0 if needle is actually within the item.
      : key - needle
  })
  if (idx < 0) idx = -idx - 1 // Handle sparse lists

  for (; idx < list.length; idx++) {
    let item = list[idx]
    const key = getKey(item)
    if (key >= endKey) break

    const len = m.len(item)

    // Just a check - the item must overlap with the start-end range.
    assert(key + len > startKey)

    if (key < startKey) {
      // Trim the item.
      item = truncate(cloneItem(item, m), startKey - key)
    }

    if (key + len > endKey) {
      item = cloneItem(item, m) // Might double-clone. Eh.
      truncate(item, endKey - key)
    }

    yield item
  }
}





export type SimpleRLESpan<T> = { val: T, length: number }

export const simpleRLESpanMethods: MergeMethods<SimpleRLESpan<any>> & SplitMethods<SimpleRLESpan<any>> = {
  len: (item) => item.length,
  tryAppend(to, from) {
    if (to.val === from.val) {
      to.length += from.length
      return true
    } else return false
  },
  truncate(item, offset) {
    const trimmedLength = item.length - offset
    item.length = offset
    return {
      val: item.val,
      length: trimmedLength
    }
  },
}

export type SimpleKeyedRLESpan<T> = { key: number } & SimpleRLESpan<T>

export const simpleKeyedSpanMethods: AllRLEMethods<SimpleKeyedRLESpan<any>> = {
  len: (item) => item.length,
  tryAppend(to, from) {
    if (to.val === from.val && to.key + to.length === from.key) {
      to.length += from.length
      return true
    } else return false
  },
  truncate(item, offset) {
    const trimmedLength = item.length - offset
    item.length = offset
    return {
      val: item.val,
      key: item.key + offset,
      length: trimmedLength,
    }
  },
  getKey: item => item.key,
}


