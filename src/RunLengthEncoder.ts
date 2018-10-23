import { Pixel } from './types';

function comparePixel(a?: Pixel, b?: Pixel) {
  if (!a || !b) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const MAX_SECTION_LENGTH = 127;

export default class RunLengthEncoder {

  private lastPixel?: Pixel;
  private pixelCount = 0;
  private sectionIndex = 1;
  private willCompress = false;
  private section: Uint8Array;

  constructor(bytesPerPixel: number) {
    this.section = new Uint8Array((MAX_SECTION_LENGTH * bytesPerPixel) + 1);
  }

  private writePixelToSection(pixel: Pixel) {
    this.section.set(pixel, this.sectionIndex);
    this.sectionIndex += pixel.length;
    this.pixelCount += 1;
  }

  private get isSectionFull() {
    return this.pixelCount === MAX_SECTION_LENGTH;
  }

  flush() {
    if (!this.willCompress && this.lastPixel) {
      this.writePixelToSection(this.lastPixel);
    }
    return this.internalFlush();
  }

  private internalFlush() {
    let out = null;
    if (this.pixelCount > 0) {
      out = new Uint8Array(this.section.subarray(0, this.sectionIndex));
      out[0] = this.willCompress ? (MAX_SECTION_LENGTH + 1) : 0;
      out[0] |= this.pixelCount & MAX_SECTION_LENGTH;
    }
    this.pixelCount = 0;
    this.sectionIndex = 1;
    return out;
  }

  encode(pixel: Pixel) {
    let out = null;

    if (this.willCompress) {
      if (comparePixel(pixel, this.lastPixel)) {
        this.pixelCount += 1;

        if (this.isSectionFull) {
          out = this.internalFlush();
          this.willCompress = false;
          this.lastPixel = undefined;
        }
      } else {
        out = this.internalFlush();
        this.willCompress = false;
        this.lastPixel = new Uint8Array(pixel);
      }
    } else if (this.lastPixel && comparePixel(pixel, this.lastPixel)) {
      out = this.internalFlush();
      this.willCompress = true;
      this.sectionIndex = 1;
      this.writePixelToSection(this.lastPixel);
      this.pixelCount = 2;
    } else {
      if (this.lastPixel) this.writePixelToSection(this.lastPixel);
      if (this.isSectionFull) out = this.internalFlush();

      this.lastPixel = new Uint8Array(pixel);
    }
    return out;
  }
}
