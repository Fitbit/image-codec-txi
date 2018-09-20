export default class BufferCursor {
  private p = 0;
  private view: DataView;
  public buffer: ArrayBuffer;

  constructor(public length: number) {
    this.buffer = new ArrayBuffer(length);
    this.view = new DataView(this.buffer);
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

  public writeUInt8Array(arr: number[] | Uint8Array) {
    for (const byte of arr) {
      this.view.setUint8(this.p, byte);
      this.p += 1;
    }
  }

  public writeUInt32LEArray(arr: number[] | Uint32Array) {
    for (const val of arr) {
      this.view.setUint32(this.p, val, true);
      this.p += 4;
    }
  }
}
