import BufferCursor from './BufferCursor';
import { ImageData, Pixel, TXIEncoderOptions, TXIOutputFormat } from './types';
import RunLengthEncoder from './RunLengthEncoder';

enum TextureFormat {
  A8 = 0x00080008,
  BGR565 = 0x01100565,
  BGRA8888 = 0x01208888,
  ABGR6666 = 0x02186666,
  ABGR8888 =  0x02208888,
}

const enum TextureCompression {
  RLE = 0x10000000,
}

const TXI_FILE_TYPE = 0x0A697874;
const TXI_FILE_VERSION = 0x20000028;
const TXI_HEADER_LENGTH = 40;
const INPUT_FORMAT_BPP = 4;

function rescaleColor(value: number, newMax: number) {
  return Math.round(value / 255 * newMax);
}

const pixelEncoders: { [format: number]: (pixel: Uint8ClampedArray) => number[] } = {
  [TextureFormat.A8]: ([r]) => [r],
  [TextureFormat.BGRA8888]: ([r, g, b, a]) => [b, g, r, a],
  [TextureFormat.ABGR8888]: ([r, g, b, a]) => [a, b, g, r],
  [TextureFormat.BGR565]: ([r8, g8, b8]) => {
    const r5 = rescaleColor(r8, 31);
    const g6 = rescaleColor(g8, 63);
    const b5 = rescaleColor(b8, 31);

    return [
      0xFF & ((g6 << 5) | b5), // gggbbbbb
      0xFF & ((g6 >> 3) | (r5 << 3)), // rrrrrggg
    ];
  },
  [TextureFormat.ABGR6666]: (pixel) => {
    if (pixel[3] === 0) return [0, 0, 0];

    const [r, g, b, a] = pixel.map(channel => rescaleColor(channel, 63));
    return [
      0xFF & ((b << 6) | a), // bbaaaaaa
      0xFF & ((g << 4) | (b >> 2)), // ggggbbbb
      0xFF & ((r << 2) | (g >> 4)), // rrrrrrgg
    ];
  },
};

function findTextureFormat(outputFormat: TXIOutputFormat, rle: boolean) {
  if (outputFormat === TXIOutputFormat.RGBA8888) {
    return rle ? TextureFormat.ABGR8888 : TextureFormat.BGRA8888;
  }
  switch (outputFormat) {
    case TXIOutputFormat.A8: return TextureFormat.A8;
    case TXIOutputFormat.RGB565: return TextureFormat.BGR565;
    case TXIOutputFormat.RGBA6666: return TextureFormat.ABGR6666;
  }

  throw new Error(`No known texture format for TXI output format ${outputFormat}`);
}

function arrayBufferConcat(buffers: ArrayBuffer[]) {
  const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return combined.buffer;
}

class TXIEncoder {
  private rle?: RunLengthEncoder;
  private cursor!: BufferCursor;
  private textureFormat!: TextureFormat;

  constructor(
    private image: ImageData,
  ) { }

  private emit(pixel: Pixel) {
    const packed = this.rle ? this.rle.encode(pixel) : pixel;
    if (packed) this.cursor.writeUInt8Array(packed);
  }

  private * rows() {
    for (let y = 0; y < this.height; y += 1) yield this.row(y);
    if (!this.rle) yield this.row(this.height - 1);
  }

  private * row(y: number) {
    let packed;
    for (let x = 0; x < this.width; x += 1) {
      const offset = ((this.width * y) + x) * INPUT_FORMAT_BPP;
      const pixel = this.image.data.slice(offset, offset + INPUT_FORMAT_BPP);
      packed = pixelEncoders[this.textureFormat](pixel);
      yield packed;
    }
    if (!this.rle && packed) yield packed;
  }

  get width() {
    return this.image.width;
  }

  get height() {
    return this.image.height;
  }

  private buildHeader(imageDataLen: number) {
    let formatType = this.textureFormat;
    if (this.rle) formatType |= TextureCompression.RLE;

    const headerArray = [
      TXI_FILE_TYPE,
      TXI_FILE_VERSION,
      imageDataLen,
      0, // data offset (bytes)
      formatType,
      this.rle ? 0 : 1,
      this.width,
      this.height,
      imageDataLen,
      0xDEADBEEF,
    ];

    const cursor = new BufferCursor(TXI_HEADER_LENGTH);
    cursor.writeUInt32LEArray(headerArray);
    return cursor.buffer;
  }

  private maxOutputSize(bytesPerPixel: number) {
    // RLE has no padding or duplicated rows, but in the worst case where nothing
    // can be compressed incurs a 1-byte per pixel overhead
    const maxBytesWithRLE = this.width * this.height * (bytesPerPixel + 1);

    // Without RLE, the worst case is more complex:
    // - The final row is duplicated, so height + 1.
    // - For each row, the final pixel is duplicated, so width + 1.
    // - Each row is padded up to a 32-bit boundary, so add a possible
    // 3 bytes for each row we write.
    const maxBytesWithoutRLE =
      ((this.width + 1) * (this.height + 1) * bytesPerPixel) + ((this.height + 1) * 3);

    return this.rle ? maxBytesWithRLE : maxBytesWithoutRLE;
  }

  encode({ rle, outputFormat }: { rle: boolean, outputFormat: TXIOutputFormat }) {
    this.textureFormat = findTextureFormat(outputFormat, rle);
    const bytesPerPixel = pixelEncoders[this.textureFormat](
      new Uint8ClampedArray([0, 0, 0, 0]),
    ).length;
    this.rle = rle ? new RunLengthEncoder(bytesPerPixel) : undefined;

    this.cursor = new BufferCursor(this.maxOutputSize(bytesPerPixel));

    for (const row of this.rows()) {
      for (const pixel of row) this.emit(pixel);

      // Align to a 32-bit boundary
      if (!this.rle) this.cursor.seek((this.cursor.tell() + 3) & ~3);
    }

    if (this.rle) {
      const leftovers = this.rle.flush();
      if (leftovers) this.cursor.writeUInt8Array(leftovers);
    }

    const imageDataBuf = this.cursor.slice();
    const headerBuf = this.buildHeader(imageDataBuf.byteLength);
    return arrayBufferConcat([headerBuf, imageDataBuf]);
  }
}

export function encode(image: ImageData, options: TXIEncoderOptions) {
  const outputFormat = options.outputFormat || TXIOutputFormat.RGBA8888;

  const encoder = new TXIEncoder(image);
  if (options.rle !== 'auto') {
    return encoder.encode({
      outputFormat,
      rle: !!options.rle,
    });
  }

  const withoutRLE = encoder.encode({ outputFormat, rle: false });
  const withRLE = encoder.encode({ outputFormat, rle: true });
  return withoutRLE.byteLength > withRLE.byteLength ? withRLE : withoutRLE;
}
