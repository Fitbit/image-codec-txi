export default class BufferCursor {
  private p = 0;
  private typedBuffer: Uint8Array;

  constructor(public length: number) {
    this.typedBuffer = new Uint8Array(length);
  }

  public get buffer() {
    return this.typedBuffer.buffer;
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
    this.typedBuffer.set(arr, this.p);
    this.p += arr.length;
  }
}
