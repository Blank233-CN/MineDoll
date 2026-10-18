(function (global) {
  'use strict';

  function ByteWriter(initialSize) {
    this.data = new Uint8Array(initialSize || 65536);
    this.length = 0;
  }

  ByteWriter.prototype.ensure = function (extra) {
    if (this.length + extra <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  };

  ByteWriter.prototype.byte = function (value) {
    this.ensure(1);
    this.data[this.length++] = value & 0xFF;
  };

  ByteWriter.prototype.u16 = function (value) {
    this.ensure(2);
    this.data[this.length++] = value & 0xFF;
    this.data[this.length++] = (value >> 8) & 0xFF;
  };

  ByteWriter.prototype.bytes = function (values) {
    this.ensure(values.length);
    this.data.set(values, this.length);
    this.length += values.length;
  };

  ByteWriter.prototype.result = function () {
    return this.data.subarray(0, this.length);
  };

  /**
   * Minimal GIF89a writer. The palette is a fixed 256-color table and every
   * frame is a full-size indexed image, which is all a flat 3D render needs.
   */
  function GifWriter(width, height, palette, transparentIndex) {
    this.width = width;
    this.height = height;
    this.palette = palette;
    this.transparentIndex = typeof transparentIndex === 'number' ? transparentIndex : -1;
    this.out = new ByteWriter(width * height);
  }

  GifWriter.prototype.start = function (loop) {
    this.out.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    this.out.u16(this.width);
    this.out.u16(this.height);
    this.out.byte(0xF7); // global color table, 256 colors
    this.out.byte(0); // background color index
    this.out.byte(0); // pixel aspect ratio
    this.out.bytes(this.palette);
    // NETSCAPE2.0 looping extension
    this.out.bytes([0x21, 0xFF, 0x0B]);
    this.out.bytes([0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]);
    this.out.bytes([0x03, 0x01, loop & 0xFF, (loop >> 8) & 0xFF, 0x00]);
  };

  GifWriter.prototype.addFrame = function (indices, delayCentiseconds) {
    const transparent = this.transparentIndex >= 0;
    // Graphic control extension
    this.out.byte(0x21);
    this.out.byte(0xF9);
    this.out.byte(0x04);
    this.out.byte((2 << 2) | (transparent ? 1 : 0)); // dispose to background
    this.out.u16(delayCentiseconds || 4);
    this.out.byte(transparent ? this.transparentIndex : 0);
    this.out.byte(0);
    // Image descriptor
    this.out.byte(0x2C);
    this.out.u16(0);
    this.out.u16(0);
    this.out.u16(this.width);
    this.out.u16(this.height);
    this.out.byte(0);
    this.out.byte(8); // LZW minimum code size
    this._writeLZW(indices);
    this.out.byte(0); // block terminator
  };

  GifWriter.prototype._writeLZW = function (indices) {
    const clearCode = 256;
    const endCode = 257;
    const data = [];

    let codeSize = 9;
    let nextCode = 258;
    let dict = new Map();
    let bitBuffer = 0;
    let bitCount = 0;

    function writeCode(code) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        data.push(bitBuffer & 0xFF);
        bitBuffer >>>= 8;
        bitCount -= 8;
      }
      // The decoder grows its table one code behind the encoder, so the
      // code-size bump happens after emitting a code, not right after
      // inserting a dictionary entry.
      if (nextCode > (1 << codeSize) - 1 && codeSize < 12) {
        codeSize++;
      }
    }

    writeCode(clearCode);

    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const value = indices[i];
      const key = (prefix << 8) | value;
      const existing = dict.get(key);

      if (existing !== undefined) {
        prefix = existing;
      } else {
        writeCode(prefix);
        if (nextCode < 4096) {
          dict.set(key, nextCode++);
        } else {
          writeCode(clearCode);
          dict = new Map();
          codeSize = 9;
          nextCode = 258;
        }
        prefix = value;
      }
    }

    writeCode(prefix);
    writeCode(endCode);
    if (bitCount > 0) {
      data.push(bitBuffer & 0xFF);
    }

    for (let offset = 0; offset < data.length; offset += 255) {
      const length = Math.min(255, data.length - offset);
      this.out.byte(length);
      this.out.bytes(data.slice(offset, offset + length));
    }
  };

  GifWriter.prototype.finish = function () {
    this.out.byte(0x3B);
    return new Blob([this.out.result()], { type: 'image/gif' });
  };

  function expand5(value) {
    return (value << 3) | (value >> 2);
  }

  function keyOf(r, g, b) {
    return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  }

  /**
   * Build a 256-color palette from a 5-bit-per-channel histogram.
   * Index 0 is reserved for transparency when requested.
   */
  function buildPalette(histogram, transparent) {
    const palette = new Uint8Array(768);
    const lookup = new Int16Array(32768).fill(-1);
    const used = [];

    for (let key = 0; key < 32768; key++) {
      if (histogram[key] > 0) used.push(key);
    }
    used.sort(function (a, b) {
      return histogram[b] - histogram[a];
    });

    const limit = transparent ? 255 : 256;
    const chosen = used.slice(0, limit);
    const colors = [];
    let index = transparent ? 1 : 0;

    for (let i = 0; i < chosen.length; i++) {
      const key = chosen[i];
      const r = expand5((key >> 10) & 31);
      const g = expand5((key >> 5) & 31);
      const b = expand5(key & 31);
      palette[index * 3] = r;
      palette[index * 3 + 1] = g;
      palette[index * 3 + 2] = b;
      lookup[key] = index;
      colors.push([r, g, b, index]);
      index++;
    }

    for (let key = 0; key < 32768; key++) {
      if (lookup[key] !== -1) continue;
      const r = expand5((key >> 10) & 31);
      const g = expand5((key >> 5) & 31);
      const b = expand5(key & 31);
      let best = colors.length ? colors[0][3] : 0;
      let bestDistance = Infinity;
      for (let i = 0; i < colors.length; i++) {
        const color = colors[i];
        const dr = r - color[0];
        const dg = g - color[1];
        const db = b - color[2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = color[3];
        }
      }
      lookup[key] = best;
    }

    return { palette: palette, lookup: lookup };
  }

  global.GifWriter = GifWriter;
  global.GifPalette = {
    keyOf: keyOf,
    build: buildPalette
  };
})(window);
