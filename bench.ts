import fs from 'fs';

import benchmark from 'benchmark';
import { PNG } from 'pngjs';

// tslint:disable-next-line:import-name
import * as imageCodecTxi from '.';
import { join } from 'path';

const inputPNG = PNG.sync.read(
  fs.readFileSync(join(__dirname, 'src', '__test__', 'transparency-rgba.png')),
);

const inputImage = {
  data: new Uint8ClampedArray(inputPNG.data),
  width: inputPNG.width,
  height: inputPNG.height,
};

const suite = new benchmark.Suite();

suite
  .add('RGBA8888', () => {
    imageCodecTxi.encode(inputImage, {
      rle: 'auto',
      outputFormat: imageCodecTxi.TXIOutputFormat.RGBA8888,
    });
  })
  .add('RGBA4444', () => {
    imageCodecTxi.encode(inputImage, {
      rle: 'auto',
      outputFormat: imageCodecTxi.TXIOutputFormat.RGBA4444,
    });
  })
  .add('RGBA6666', () => {
    imageCodecTxi.encode(inputImage, {
      rle: 'auto',
      outputFormat: imageCodecTxi.TXIOutputFormat.RGBA6666,
    });
  })
  .add('RGB565', () => {
    imageCodecTxi.encode(inputImage, {
      rle: 'auto',
      outputFormat: imageCodecTxi.TXIOutputFormat.RGB565,
    });
  })
  .add('A8', () => {
    imageCodecTxi.encode(inputImage, {
      rle: 'auto',
      outputFormat: imageCodecTxi.TXIOutputFormat.A8,
    });
  })
  .on('cycle', (event: any) => {
    console.log(String(event.target));
    console.log(`${(event.target.stats.mean * 1000).toFixed(2)} ms/run`);
  })
  .on('error', (event: any) => {
    console.error(`Error running ${event.target.name}:`);
    console.error(event.target.error);
  })
  .run({ async: true });
