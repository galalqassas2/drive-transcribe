export class BoundedLruCache<K, V> {
  private readonly entries = new Map<K, { value: V; size: number }>()
  private totalSize = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxSize: number,
    private readonly getSize: (value: V) => number,
  ) {}

  get(key: K) {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V) {
    const size = this.getSize(value)
    const previous = this.entries.get(key)

    if (previous) {
      this.totalSize -= previous.size
      this.entries.delete(key)
    }

    if (size > this.maxSize) return

    this.entries.set(key, { value, size })
    this.totalSize += size

    while (this.entries.size > this.maxEntries || this.totalSize > this.maxSize) {
      const oldestKey = this.entries.keys().next().value as K | undefined
      if (oldestKey === undefined) break

      const oldest = this.entries.get(oldestKey)
      this.entries.delete(oldestKey)
      this.totalSize -= oldest?.size ?? 0
    }
  }

  clear() {
    this.entries.clear()
    this.totalSize = 0
  }
}
