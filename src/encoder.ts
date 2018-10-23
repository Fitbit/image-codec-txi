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

const textureBPP: { [format: number]: number } = {
  [TextureFormat.A8]: 1,
  [TextureFormat.BGRA8888]: 4,
  [TextureFormat.ABGR8888]: 4,
  [TextureFormat.BGR565]: 2,
  [TextureFormat.ABGR6666]: 3,
};

type PixelEncoder = (data: Uint8Array, offset: number, output: Pixel) => void;

const pixelEncoders: { [format: number]: PixelEncoder } = {
  [TextureFormat.A8]: (data, offset, output) => {
    output[0] = data[offset];
  },
  [TextureFormat.BGRA8888]: (data, offset, output) => {
    output[0] = data[offset + 2];
    output[1] = data[offset + 1];
    output[2] = data[offset];
    output[3] = data[offset + 3];
  },
  [TextureFormat.ABGR8888]: (data, offset, output) => {
    output[0] = data[offset + 3];
    output[1] = data[offset + 2];
    output[2] = data[offset + 1];
    output[3] = data[offset];
  },
  [TextureFormat.BGR565]: (data, offset, output) => {
    const r5 = rescaleColor(data[offset], 31);
    const g6 = rescaleColor(data[offset + 1], 63);
    const b5 = rescaleColor(data[offset + 2], 31);

    output[0] = 0xFF & ((g6 << 5) | b5); // gggbbbbb
    output[1] = 0xFF & ((g6 >> 3) | (r5 << 3)); // rrrrrggg
  },
  [TextureFormat.ABGR6666]: (data, offset, output) => {
    if (data[offset + 3] === 0) {
      output.fill(0);
      return;
    }

    const r = rescaleColor(data[offset], 63);
    const g = rescaleColor(data[offset + 1], 63);
    const b = rescaleColor(data[offset + 2], 63);
    const a = rescaleColor(data[offset + 3], 63);

    output[0] = 0xFF & ((b << 6) | a); // bbaaaaaa
    output[1] = 0xFF & ((g << 4) | (b >> 2)); // ggggbbbb
    output[2] = 0xFF & ((r << 2) | (g >> 4)); // rrrrrrgg
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
  private imageData!: Uint8Array;
  private outputPixel!: Uint8Array;
  private encoder!: PixelEncoder;

  constructor(
    private image: ImageData,
  ) { }

  private emit(pixel: Pixel) {
    const packed = this.rle ? this.rle.encode(pixel) : pixel;
    if (packed) this.cursor.writeArray(packed);
  }

  private process() {
    for (let y = 0; y < this.height; y += 1) this.processRow(y);
    if (this.rle) {
      const leftovers = this.rle.flush();
      if (leftovers) this.cursor.writeArray(leftovers);
    } else {
      this.processRow(this.height - 1);
    }
  }

  private processRow(y: number) {
    const offset = this.width * y;

    for (let x = 0; x < this.width; x += 1) {
      const idx = (offset + x) * INPUT_FORMAT_BPP;
      this.encoder(this.imageData, idx, this.outputPixel);
      this.emit(this.outputPixel);
    }

    if (!this.rle) {
      this.emit(this.outputPixel);
      this.cursor.seek((this.cursor.tell() + 3) & ~3);
    }
  }

  get width() {
    return this.image.width;
  }

  get height() {
    return this.image.height;
  }

  get outputBPP() {
    return textureBPP[this.textureFormat];
  }

  private buildHeader(imageDataLen: number) {
    let formatType = this.textureFormat;
    if (this.rle) formatType |= TextureCompression.RLE;

    return new Uint32Array([
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
    ]).buffer;
  }

  maxOutputSize(withRLE: boolean) {
    // RLE has no padding or duplicated rows, but in the worst case where nothing
    // can be compressed incurs a 1-byte per pixel overhead
    const maxBytesWithRLE = this.width * this.height * (this.outputBPP + 1);

    // Without RLE, the worst case is more complex:
    // - The final row is duplicated, so height + 1.
    // - For each row, the final pixel is duplicated, so width + 1.
    // - Each row is padded up to a 32-bit boundary, so add a possible
    // 3 bytes for each row we write.
    const maxBytesWithoutRLE =
      ((this.width + 1) * (this.height + 1) * this.outputBPP) + ((this.height + 1) * 3);

    return withRLE ? maxBytesWithRLE : maxBytesWithoutRLE;
  }

  encode({ rle, outputFormat }: { rle: boolean, outputFormat: TXIOutputFormat }) {
    this.textureFormat = findTextureFormat(outputFormat, rle);
    this.encoder = pixelEncoders[this.textureFormat];
    this.rle = rle ? new RunLengthEncoder(this.outputBPP) : undefined;

    this.outputPixel = new Uint8Array(this.outputBPP);
    this.cursor = new BufferCursor(this.maxOutputSize(!!this.rle));

    this.imageData = new Uint8Array(this.image.data.buffer);
    this.process();

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

  const withRLE = encoder.encode({ outputFormat, rle: true });
  const sizeWithoutRLE = encoder.maxOutputSize(false) + TXI_HEADER_LENGTH;
  if (withRLE.byteLength <= sizeWithoutRLE) return withRLE;

  return encoder.encode({ outputFormat, rle: false });
}
