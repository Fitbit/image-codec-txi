export default class BufferCursor {
  private p = 0;
  array: Uint8Array;

  constructor(public length: number) {
    this.array = new Uint8Array(length);
  }

  public get buffer() {
    return this.array.buffer;
  }

  public seek(offset: number) {
    this.p = offset;
  }

  public tell() {
    return this.p;
  }

  public slice(from = 0, to = this.tell()) {
    return this.buffer.slice(from, to);
  }

  public writeArray(arr: Uint8Array) {
    this.array.set(arr, this.p);
    this.p += arr.length;
  }
}
