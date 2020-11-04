import BufferCursor from './BufferCursor';
import { Pixel } from './types';

function comparePixel(a: Pixel, b: Pixel) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const MAX_SECTION_LENGTH = 127;

export default class RunLengthEncoder {
  private lastPixel: Pixel;
  private lastPixelValid = false;
  private pixelCount = 0;
  /** Offset into the destination buffer to place the section header. */
  private headerIndex: number;
  private willCompress = false;

  constructor(private destination: BufferCursor, bytesPerPixel: number) {
    this.headerIndex = this.destination.tell();
    this.lastPixel = new Uint8Array(bytesPerPixel);
  }

  private writePixelToSection() {
    if (this.pixelCount === 0) this.destination.seek(this.headerIndex + 1);
    this.destination.writeArray(this.lastPixel);
    this.pixelCount += 1;
  }

  private get isSectionFull() {
    return this.pixelCount === MAX_SECTION_LENGTH;
  }

  private setLastPixel(pixel: Pixel) {
    this.lastPixel.set(pixel);
    this.lastPixelValid = true;
  }

  flush() {
    if (!this.willCompress && this.lastPixelValid) {
      this.writePixelToSection();
    }
    return this.internalFlush();
  }

  private internalFlush() {
    if (this.pixelCount > 0) {
      let headerByte = this.willCompress ? MAX_SECTION_LENGTH + 1 : 0;
      headerByte |= this.pixelCount & MAX_SECTION_LENGTH;
      this.destination.array[this.headerIndex] = headerByte;
    }
    this.pixelCount = 0;
    this.headerIndex = this.destination.tell();
  }

  encode(pixel: Pixel) {
    if (this.willCompress) {
      if (this.lastPixelValid && comparePixel(pixel, this.lastPixel)) {
        this.pixelCount += 1;

        if (this.isSectionFull) {
          this.internalFlush();
          this.willCompress = false;
          this.lastPixelValid = false;
        }
      } else {
        this.internalFlush();
        this.willCompress = false;
        this.setLastPixel(pixel);
      }
    } else if (this.lastPixelValid && comparePixel(pixel, this.lastPixel)) {
      this.internalFlush();
      this.willCompress = true;
      this.writePixelToSection();
      this.pixelCount = 2;
    } else {
      if (this.lastPixelValid) this.writePixelToSection();
      if (this.isSectionFull) this.internalFlush();

      this.setLastPixel(pixel);
    }
  }
}
