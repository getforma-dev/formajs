export interface TypedStorage<T> {
  get(): T | null;
  set(value: T): void;
  remove(): void;
  key: string;
}

export interface StorageOptions<T> {
  serialize?: (v: T) => string;
  deserialize?: (s: string) => T;
  /** Optional validator — return true if the deserialized value is valid. */
  validate?: (v: unknown) => v is T;
}
