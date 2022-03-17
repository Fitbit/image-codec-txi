export type Pixel = Uint8Array;

export interface ImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export enum TXIOutputFormat {
  RGB565 = 'RGB565',
  RGBA4444 = 'RGBA4444',
  RGBA6666 = 'RGBA6666',
  RGBA8888 = 'RGBA8888',
  A8 = 'A8',
}

export interface TXIEncoderOptions {
  rle?: boolean | 'auto';
  outputFormat?: TXIOutputFormat;
}

export type RGBAOutputFormat =
  | TXIOutputFormat.RGBA8888
  | TXIOutputFormat.RGBA6666
  | TXIOutputFormat.RGBA4444;
