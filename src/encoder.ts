import BufferCursor from './BufferCursor';
import { ImageData, Pixel, TXIEncoderOptions, TXIOutputFormat } from './types';
import RunLengthEncoder from './RunLengthEncoder';

enum TextureFormat {
  A8 = 0x00080008,
  BGR565 = 0x01100565,
  BGRA8888 = 0x01208888,
  ABGR6666 = 0x02186666,
  ABGR8888 = 0x02208888,
}

const enum TextureCompression {
  RLE = 0x10000000,
}

const TXI_FILE_TYPE = 0x0a697874;
const TXI_FILE_VERSION = 0x20000028;
const TXI_HEADER_LENGTH = 40;
const INPUT_FORMAT_BPP = 4;

function rescaleColor(value: number, newMax: number) {
  return ((value * newMax + 127) / 255) | 0;
}

// BPP = bytes per pixel
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

    output[0] = 0xff & ((g6 << 5) | b5); // gggbbbbb
    output[1] = 0xff & ((g6 >> 3) | (r5 << 3)); // rrrrrggg
  },
  [TextureFormat.ABGR6666]: (data, offset, output) => {
    if (data[offset + 3] === 0) {
      output[0] = 0;
      output[1] = 0;
      output[2] = 0;
      return;
    }

    const r = rescaleColor(data[offset], 63);
    const g = rescaleColor(data[offset + 1], 63);
    const b = rescaleColor(data[offset + 2], 63);
    const a = rescaleColor(data[offset + 3], 63);

    output[0] = 0xff & ((b << 6) | a); // bbaaaaaa
    output[1] = 0xff & ((g << 4) | (b >> 2)); // ggggbbbb
    output[2] = 0xff & ((r << 2) | (g >> 4)); // rrrrrrgg
  },
};

function findTextureFormat(outputFormat: TXIOutputFormat, rle: boolean) {
  if (outputFormat === TXIOutputFormat.RGBA8888) {
    return rle ? TextureFormat.ABGR8888 : TextureFormat.BGRA8888;
  }
  switch (outputFormat) {
    case TXIOutputFormat.A8:
      return TextureFormat.A8;
    case TXIOutputFormat.RGB565:
      return TextureFormat.BGR565;
    case TXIOutputFormat.RGBA6666:
      return TextureFormat.ABGR6666;
  }

  throw new Error(
    `No known texture format for TXI output format ${outputFormat}`,
  );
}

function maxOutputSize(
  image: ImageData,
  outputFormat: TXIOutputFormat,
  withRLE: boolean,
) {
  const { width, height } = image;
  const bpp = textureBPP[findTextureFormat(outputFormat, withRLE)];

  // RLE has no padding or duplicated rows, but in the worst case where nothing
  // can be compressed incurs a 1-byte per pixel overhead
  const maxBytesWithRLE = width * height * (bpp + 1);

  // Without RLE, the worst case is more complex:
  // - The final row is duplicated, so height + 1.
  // - For each row, the final pixel is duplicated, so width + 1.
  // - Each row is padded up to a 32-bit boundary, so add a possible
  // 3 bytes for each row we write.
  const maxBytesWithoutRLE =
    (width + 1) * (height + 1) * bpp + (height + 1) * 3;

  return (withRLE ? maxBytesWithRLE : maxBytesWithoutRLE) + TXI_HEADER_LENGTH;
}

function encodeWithFixedRLE(
  image: ImageData,
  options: { outputFormat: TXIOutputFormat; rle: boolean },
) {
  const textureFormat = findTextureFormat(options.outputFormat, options.rle);
  const bpp = textureBPP[textureFormat];
  const encoder = pixelEncoders[textureFormat];

  const imageData = new Uint8Array(image.data.buffer);
  const { width, height } = image;

  const cursor = new BufferCursor(
    maxOutputSize(image, options.outputFormat, options.rle),
  );
  cursor.seek(TXI_HEADER_LENGTH);

  const rle = options.rle ? new RunLengthEncoder(cursor, bpp) : undefined;
  const outputPixel = new Uint8Array(bpp);

  let emit: () => void;
  if (rle) {
    emit = () => rle.encode(outputPixel);
  } else {
    emit = () => cursor.writeArray(outputPixel);
  }

  function writeRow(y: number) {
    const offset = width * y;

    for (let x = 0; x < width; x += 1) {
      const idx = (offset + x) * INPUT_FORMAT_BPP;
      encoder(imageData, idx, outputPixel);
      emit();
    }

    if (!rle) {
      emit();
      cursor.seek((cursor.tell() + 3) & ~3);
    }
  }

  function writeBody() {
    for (let y = 0; y < height; y += 1) writeRow(y);
    if (rle) {
      rle.flush();
    } else {
      writeRow(height - 1);
    }
  }

  function writeHeader() {
    let formatType = textureFormat;
    if (rle) formatType |= TextureCompression.RLE;

    const imageDataLen = cursor.tell() - TXI_HEADER_LENGTH;

    const dv = new DataView(cursor.buffer);
    [
      TXI_FILE_TYPE,
      TXI_FILE_VERSION,
      imageDataLen,
      0, // data offset (bytes)
      formatType,
      rle ? 0 : 1,
      width,
      height,
      imageDataLen,
      0xdeadbeef,
    ].forEach((val, index) => dv.setUint32(index * 4, val, true));
  }

  writeBody();
  writeHeader();

  return cursor.slice();
}

export function encode(image: ImageData, options: TXIEncoderOptions) {
  const outputFormat = options.outputFormat || TXIOutputFormat.RGBA8888;

  if (options.rle !== 'auto') {
    return encodeWithFixedRLE(image, { outputFormat, rle: !!options.rle });
  }

  const withRLE = encodeWithFixedRLE(image, { outputFormat, rle: true });
  const sizeWithoutRLE = maxOutputSize(image, outputFormat, false);
  if (withRLE.byteLength <= sizeWithoutRLE) return withRLE;

  return encodeWithFixedRLE(image, { outputFormat, rle: false });
}
