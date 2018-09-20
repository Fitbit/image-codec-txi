@fitbit/image-codec-txi
===============

TXI is an image format used on some Fitbit devices. This package is used to convert a raw bitmap raster to a TXI formatted image that is supported on the device.

## API

### `encode(image: ImageData, options: TXIEncoderOptions)`:

#### Interface: ImageData
```
{
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
```

#### Interface: TXIEncoderOptions
```
{
  rle?: boolean | 'auto';
  outputFormat?: TXIOutputFormat;
}
```

#### Enum: TXIOutputFormat
```
{
  RGB565 = 'RGB565',
  RGBA6666 = 'RGBA6666',
  RGBA8888 = 'RGBA8888',
  A8 = 'A8',
}
```
