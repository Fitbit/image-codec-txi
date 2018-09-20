import fs from 'fs';
import path from 'path';

import { PNG } from 'pngjs';

import { encode } from './encoder';
import { TXIOutputFormat } from './types';

function testResourcePath(...paths: string[]) {
  return path.resolve(__dirname, '__test__', ...paths);
}

function loadTestResource(...paths: string[]) {
  return fs.readFileSync(testResourcePath(...paths));
}

function readPNG(buffer: Buffer) {
  return PNG.sync.read(buffer);
}

function checkImage(
  filename: string,
  rle: boolean | 'auto',
  outputFormat: TXIOutputFormat = TXIOutputFormat.RGBA8888,
  expectRLEIsSmaller = true,
) {
  const uncompressed = readPNG(loadTestResource(`${filename}.png`));
  const inputImage = {
    data: new Uint8ClampedArray(uncompressed.data),
    width: uncompressed.width,
    height: uncompressed.height,
  };

  const actualCompressed = Buffer.from(encode(inputImage, { rle, outputFormat }));

  let expectedCompressedPath = `${filename}.txi.${outputFormat.toLowerCase()}`;
  if (rle !== false && expectRLEIsSmaller) expectedCompressedPath += '.rle';
  const expectedCompressed = loadTestResource(expectedCompressedPath);

  expect(actualCompressed.byteLength).toEqual(expectedCompressed.byteLength);
  expect(expectedCompressed.compare(actualCompressed)).toBe(0);
}

for (const withRLE of [true, false]) {
  describe(`with RLE encoding ${withRLE ? 'enabled' : 'disabled'}`, () => {
    it('converts an RGB PNG to RGBA8888', () => checkImage('rgb_image', withRLE));
    it('converts an RGB PNG to RGB565', () =>
      checkImage('rgb_image', withRLE, TXIOutputFormat.RGB565));
    it('converts an RGB PNG to RGBA6666', () =>
      checkImage('rgb_image', withRLE, TXIOutputFormat.RGBA6666));
    it('converts a paletted PNG', () => checkImage('palette', withRLE));
    it('converts a 1-bit PNG', () => checkImage('1bit', withRLE, TXIOutputFormat.A8));
    it('converts a very small image', () => checkImage('tiny', withRLE));
    it('converts an image that exceeds the worst case size when padded',
       () => checkImage('rle_increases_size', withRLE));
    it('converts a PNG that leaves no RLE leftover bytes to flush',
       () => checkImage('rle_no_leftovers', withRLE));
    it('converts an image that is larger when RLE encoded than unencoded',
       () => checkImage('greyscale_bands', withRLE, TXIOutputFormat.A8));
  });
}

it('returns the smaller output if RLE mode is set to auto',
   () => checkImage('greyscale_bands', 'auto', TXIOutputFormat.A8, false));

const PNG_SUITE_DIR = 'PngSuite-2017jul19';

describe('readPNG', () => {
  const pngSuite = fs.readdirSync(testResourcePath(PNG_SUITE_DIR))
    .filter(file => file.endsWith('.png'));
  const validPNGs = pngSuite.filter(file => !file.startsWith('x'));
  const corruptPNGs = pngSuite.filter(file => file.startsWith('x'));

  describe('given a valid PNG file', () => {
    it.each(validPNGs)('reads %s', (vector) => {
      expect(readPNG(loadTestResource(PNG_SUITE_DIR, vector)))
        .toBeDefined();
    });
  });

  describe('given a corrupt PNG file', () => {
    it.each(corruptPNGs)('rejects %s', (vector) => {
      expect(() => readPNG(loadTestResource(PNG_SUITE_DIR, vector)))
        .toThrow();
    });
  });

  describe('given a PNG file with transparency', () => {
    describe('when the file is RGBA', () => {
      it('decodes transparent pixels as transparent', async () => {
        const png = readPNG(loadTestResource('transparency-rgba.png'));
        expect(png.data[3]).toBe(0);
      });
    });

    describe('when the file is palletized', () => {
      it('decodes transparent pixels as transparent', async () => {
        const png = readPNG(loadTestResource('transparency-palette.png'));
        expect(png.data[3]).toBe(0);
      });
    });
  });

  describe('given an ArrayBuffer', () => {
    it('reads the file', () =>
      expect(readPNG(loadTestResource('tiny.png')))
        .toBeDefined(),
    );
  });
});
