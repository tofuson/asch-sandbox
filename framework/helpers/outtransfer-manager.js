const TEN_MINUTES = 1000 * 60 * 10
const FOUR_HOURS = 1000 * 60 * 60 * 4

class OutTransferManager {
  constructor(maxSignatureNumber) {
    this.maxSignatureNumber = maxSignatureNumber
    this.pending = new Array
    this.index = new Map
    this.cacheIds = new Set
    this.historyIds = new Set
    this.lastClearCacheTime = Date.now()
    this.lastClearHistoryTime = Date.now()
  }

  addReady(t, innerId) {
    this.cacheIds.add(t.id)
    this.cacheIds.add(innerId)
  }

  addPending(t, innerId) {
    if (!t.signatures) t.signatures = []
    this.pending.push(t)
    this.index.set(t.id, this.pending.length - 1)
    this.cacheIds.add(t.id)
    this.cacheIds.add(innerId)
  }
  
  addSignature(id, signature) {
    let pos = this.index[id]
    let ot = this.pending[pos]
    if (ot && ot.signatures.length < this.maxSignatureNumber && ot.signatures.indexOf(signature) == -1) {
      ot.signatures.push(signature)
    }
  }

  setReady(id) {
    let pos = this.index[id]
    if (this.pending[pos]) {
      this.index.delete(id)
      this.pending[pos] = null
    } else {
      this.cacheIds.add(id)
    }
  }

  getPending() {
    let results = this.pending.filter((t) => {
      return !!t
    })
    this.pending = results
    return results
  }

  has(id) {
    return this.index.has(id) || this.cacheIds.has(id) || this.historyIds.has(id)
  }

  clear() {
    let elapsed1 = Date.now() - this.lastClearCacheTime
    let elapsed2 = Date.now() - this.lastClearHistoryTime
    if (elapsed1 > TEN_MINUTES) {
      if (elapsed2 > FOUR_HOURS) {
        this.historyIds.clear()
        this.lastClearHistoryTime.clear()
      }
      for (let id of this.cacheIds) {
        this.historyIds.add(id)
      }
      this.cacheIds.clear()
      this.lastClearCacheTime = Date.now()
    }
  }
}

module.exports = OutTransferManager