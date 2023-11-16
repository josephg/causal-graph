import bs from './binary-search.js'
import { assert } from './utils.js'
import { AllRLEMethods, CommonMethods, Keyed, LVRange, MergeMethods, SplitMethods } from './types.js'


export function rlePush<T>(list: T[], m: MergeMethods<T>, newItem: T) {
  if (list.length === 0 || !m.tryAppend(list[list.length - 1], newItem)) {
    list.push(newItem)
  }
}

/**
 * Find the index of the item containing the specified needle. Returns 2s compliment
 * of desired index if the item is not found.
 */
export function rleFindIdxRaw<T>(list: T[], m: Keyed<T>, needle: number): number {
  return bs(list, needle, (entry, needle) => (
    needle < m.keyStart(entry) ? 1
      : needle >= m.keyEnd(entry) ? -1
      : 0
    // const key = m.keyStart(entry)
    // return needle < key ? 1
    //   : needle >= key + m.len(entry) ? -1
    //   : 0
  ))
}

export function rleFindEntryOpt<T>(list: T[], m: Keyed<T>, needle: number): T | null {
  const idx = rleFindIdxRaw(list, m, needle)
  return idx < 0 ? null : list[idx]
}

export function rleFindEntry<T>(list: T[], m: Keyed<T>, needle: number): T {
  const idx = rleFindIdxRaw(list, m, needle)
  if (idx < 0) throw Error('Item missing from RLE list: ' + needle)
  return list[idx]
}

/** Finds and returns an entry, and the offset into that entry. Returns null if item is missing. */
export function rleFindOpt<T>(list: T[], m: Keyed<T>, needle: number): [T, number] | null {
  const entry = rleFindEntryOpt(list, m, needle)
  return entry == null ? null : [entry, needle - m.keyStart(entry)]
}

/** Finds and returns an entry, and the offset into that entry. Throws if item is missing. */
export function rleFind<T>(list: T[], m: Keyed<T>, needle: number): [T, number] {
  const entry = rleFindEntry(list, m, needle)
  return [entry, needle - m.keyStart(entry)]
}

// export function rleFindEntry<T>(list: T[], m: Keyed<T>, needle: number): T {
//   const idx = rleFindIdxRaw(list, m, needle)
//   if (result == null) throw Error('Item missing from RLE list: ' + needle)
//   return result
// }

/** Insert the new item in its corresponding location in the list */
export function rleInsert<T>(list: T[], m: MergeMethods<T> & Keyed<T>, newItem: T) {
  const newKey = m.keyStart(newItem)
  if (list.length === 0 || newKey >= m.keyStart(list[list.length - 1])) {
    // Just push the new entry to the end of the list like normal.
    rlePush(list, m, newItem)
  } else {
    // We need to splice the new entry in. Find the index of the previous entry...
    // let idx = bs(list, newKey, (entry, needle) => m.keyStart(entry) - needle)
    let idx = rleFindIdxRaw(list, m, newKey)
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

export const itemLen = <T>(item: T, m: Keyed<T>): number => (
  m.keyEnd(item) - m.keyStart(item)
)

/** Iterate (and yield) all the items which intersect the half-open range from [startKey..endKey) */
export function *rleIterRangeRaw<T>(list: T[], m: Keyed<T>, startKey: number, endKey: number): Generator<T> {
  if (startKey === endKey) return

  // let idx = bs(list, startKey, (entry, needle) => {
  //   const key = getKey(entry)
  //   return (needle >= key && needle < key + m.len(entry))
  //     ? 0 // Return 0 if needle is actually within the item.
  //     : key - needle
  // })
  let idx = rleFindIdxRaw(list, m, startKey)
  if (idx < 0) idx = -idx - 1 // Handle sparse lists

  for (; idx < list.length; idx++) {
    let item = list[idx]
    const itemStart = m.keyStart(item)
    if (itemStart >= endKey) break

    // const len = m.len(item)
    const itemEnd = m.keyEnd(item)

    // Just a check - the item must overlap with the start-end range.
    assert(itemEnd > startKey)

    yield item
  }
}

export function *rleIterRange<T>(list: T[], m: SplitMethods<T> & Keyed<T>, startKey: number, endKey: number): Generator<T> {
  for (let item of rleIterRangeRaw(list, m, startKey, endKey)) {
    let itemStart = m.keyStart(item)
    let cloned = false
    if (itemStart < startKey) {
      // Trim the item.
      cloned = true
      item = cloneItem(item, m)
      m.truncateKeepingRight(item, startKey - itemStart)
      itemStart = startKey
    }

    const itemEnd = m.keyEnd(item)
    if (itemEnd > endKey) {
      // Trim the item from the right.
      if (!cloned) item = cloneItem(item, m) // avoid double-cloning.
      m.truncateKeepingLeft(item, endKey - itemStart)
    }

    yield item
  }
}

export function nextKey<T>(list: T[], m: Keyed<T>): number {
  return list.length === 0
    ? 0
    : m.keyEnd(list[list.length - 1])
}





// RLE methods for LVRange. TODO: Consider moving these somewhere else.

export const rangeRLE: MergeMethods<LVRange> = {
  // len: (item) => item[1] - item[0],

  tryAppend(r1, r2) {
    if (r1[1] === r2[0]) {
      r1[1] = r2[1]
      return true
    } else return false
  },
}

export const revRangeRLE: MergeMethods<LVRange> = {
  // len: (item) => item[1] - item[0],
  tryAppend(r1, r2) {
    if (r1[0] === r2[1]) {
      r1[0] = r2[0]
      return true
    } else return false
  },
}




export type SimpleRLESpan<T> = { val: T, length: number }

export const simpleRLESpanMethods: MergeMethods<SimpleRLESpan<any>> & SplitMethods<SimpleRLESpan<any>> = {
  // len: (item) => item.length,
  tryAppend(to, from) {
    if (to.val === from.val) {
      to.length += from.length
      return true
    } else return false
  },
  truncateKeepingLeft(item, offset) { item.length = offset },
  truncateKeepingRight(item, offset) { item.length -= offset },
}

export type SimpleKeyedRLESpan<T> = { key: number } & SimpleRLESpan<T>

export const simpleKeyedSpanMethods: AllRLEMethods<SimpleKeyedRLESpan<any>> = {
  // len: (item) => item.length,
  keyStart: item => item.key,
  keyEnd: item => item.key + item.length,
  tryAppend(to, from) {
    if (to.val === from.val && to.key + to.length === from.key) {
      to.length += from.length
      return true
    } else return false
  },
  truncateKeepingLeft(item, offset) { item.length = offset },
  truncateKeepingRight(item, offset) {
    item.length -= offset
    item.key += offset
  },

  // truncate(item, offset) {
  //   const trimmedLength = item.length - offset
  //   item.length = offset
  //   return {
  //     val: item.val,
  //     key: item.key + offset,
  //     length: trimmedLength,
  //   }
  // },
}


