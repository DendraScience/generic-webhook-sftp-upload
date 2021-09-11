/**
 * Basic sequential queue class that is promise-friendly.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module lib/seq-queue
 */

const { EventEmitter } = require('events')

class SeqQueue extends EventEmitter {
  constructor() {
    super()

    this.queue = []
  }

  _next() {
    if (this.queue.length > 0) {
      setImmediate(() => {
        if (!(this.queue && this.queue.length > 0)) return

        const task = this.queue.shift()
        const { done, error, fn } = task
        const ret = fn(done, error)

        if (ret instanceof Promise) {
          Promise.resolve(ret).then(done).catch(error)
        }
      })
    } else {
      this.emit('empty')
    }
  }

  cancel() {
    if (!this.queue) return

    this.queue.forEach(task => task.cancel())
    delete this.queue

    this.emit('cancelled')
  }

  push(fn) {
    if (!this.queue) return

    return new Promise((resolve, reject) => {
      const self = this

      self.queue.push({
        cancel() {
          resolve()
        },
        done(value) {
          resolve(value)
          self._next()
        },
        error(err) {
          reject(err)
          self._next()
        },
        fn
      })

      if (self.queue.length === 1) self._next()
    })
  }
}

module.exports = {
  SeqQueue
}
