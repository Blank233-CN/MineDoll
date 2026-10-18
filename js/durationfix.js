(function (global) {
  'use strict';

  // MediaRecorder 产出的 WebM / 分片 MP4 经常不写时长，系统自带播放器会显示
  // 0:00 或异常时长。这里在导出后把真实时长补进容器元数据。

  function u32(bytes, i) {
    return bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3];
  }

  function readVint(bytes, pos, isId) {
    const first = bytes[pos];
    let len = 1;
    let mask = 0x80;
    while (len <= 8 && !(first & mask)) {
      mask >>= 1;
      len++;
    }
    if (len > 8) return null;

    let value = isId ? first : (first & (0xFF >> len));
    for (let i = 1; i < len; i++) {
      value = value * 256 + bytes[pos + i];
    }
    const unknown = !isId && value === Math.pow(2, 7 * len) - 1;
    return { value: value, len: len, unknown: unknown };
  }

  function findElement(bytes, start, end, target) {
    let pos = start;
    while (pos < end) {
      const id = readVint(bytes, pos, true);
      if (!id) return null;
      const size = readVint(bytes, pos + id.len, false);
      if (!size) return null;

      const dataStart = pos + id.len + size.len;
      const sizeValue = size.unknown ? end - dataStart : size.value;

      if (id.value === target) {
        return {
          start: pos,
          idLen: id.len,
          sizeLen: size.len,
          dataStart: dataStart,
          size: sizeValue,
          known: !size.unknown
        };
      }
      if (size.unknown) return null;
      pos = dataStart + sizeValue;
    }
    return null;
  }

  function encodeSize(value) {
    let len = 1;
    while (len < 8 && value >= Math.pow(2, 7 * len) - 1) len++;
    const out = new Uint8Array(len);
    let rest = value;
    for (let i = len - 1; i >= 0; i--) {
      out[i] = rest % 256;
      rest = Math.floor(rest / 256);
    }
    out[0] |= 0x80 >> (len - 1);
    return out;
  }

  function concat(parts) {
    let total = 0;
    for (let i = 0; i < parts.length; i++) total += parts[i].length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], offset);
      offset += parts[i].length;
    }
    return out;
  }

  function fixWebm(buffer, seconds) {
    const bytes = new Uint8Array(buffer);
    const segment = findElement(bytes, 0, bytes.length, 0x18538067);
    if (!segment) return bytes;

    const segmentEnd = segment.known ? segment.dataStart + segment.size : bytes.length;
    const info = findElement(bytes, segment.dataStart, segmentEnd, 0x1549A966);
    if (!info) return bytes;

    const infoEnd = info.dataStart + info.size;
    let timecodeScale = 1000000;
    const scale = findElement(bytes, info.dataStart, infoEnd, 0x2AD7B1);
    if (scale) {
      let value = 0;
      for (let i = 0; i < scale.size; i++) value = value * 256 + bytes[scale.dataStart + i];
      if (value > 0) timecodeScale = value;
    }

    const durationValue = seconds * 1e9 / timecodeScale;
    const duration = findElement(bytes, info.dataStart, infoEnd, 0x4489);

    if (duration) {
      const view = new DataView(buffer);
      if (duration.size >= 8) {
        view.setFloat64(duration.dataStart, durationValue);
      } else if (duration.size === 4) {
        view.setFloat32(duration.dataStart, durationValue);
      }
      return bytes;
    }

    const element = new Uint8Array(11);
    element[0] = 0x44;
    element[1] = 0x89;
    element[2] = 0x88;
    new DataView(element.buffer).setFloat64(3, durationValue);

    const payload = bytes.subarray(info.dataStart, infoEnd);
    const newInfoSize = info.size + element.length;
    const rebuilt = concat([
      bytes.subarray(info.start, info.start + info.idLen),
      encodeSize(newInfoSize),
      payload,
      element
    ]);

    return concat([
      bytes.subarray(0, info.start),
      rebuilt,
      bytes.subarray(infoEnd)
    ]);
  }

  function findBox(bytes, start, end, type) {
    let pos = start;
    while (pos + 8 <= end) {
      let size = u32(bytes, pos);
      const name = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      let header = 8;

      if (size === 1) {
        if (pos + 16 > end) return null;
        const high = u32(bytes, pos + 8);
        const low = u32(bytes, pos + 12);
        size = high * 4294967296 + low;
        header = 16;
      } else if (size === 0) {
        size = end - pos;
      }

      if (size < header || pos + size > end) return null;
      if (name === type) {
        return { start: pos, dataStart: pos + header, end: pos + size };
      }
      pos += size;
    }
    return null;
  }

  function fixMp4(buffer, seconds) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const moov = findBox(bytes, 0, bytes.length, 'moov');
    if (!moov) return bytes;

    const mvhd = findBox(bytes, moov.dataStart, moov.end, 'mvhd');
    if (!mvhd) return bytes;

    const version = bytes[mvhd.dataStart];
    let timescale = 0;
    let durationAt = 0;

    if (version === 1) {
      timescale = u32(bytes, mvhd.dataStart + 20);
      durationAt = mvhd.dataStart + 24;
    } else {
      timescale = u32(bytes, mvhd.dataStart + 12);
      durationAt = mvhd.dataStart + 16;
    }
    if (!timescale) return bytes;

    const durationValue = Math.round(seconds * timescale);
    if (version === 1) {
      view.setUint32(durationAt, 0);
      view.setUint32(durationAt + 4, durationValue);
    } else {
      view.setUint32(durationAt, durationValue);
    }

    const mvex = findBox(bytes, moov.dataStart, moov.end, 'mvex');
    if (mvex) {
      const mehd = findBox(bytes, mvex.dataStart, mvex.end, 'mehd');
      if (mehd) {
        const mehdVersion = bytes[mehd.dataStart];
        if (mehdVersion === 1) {
          view.setUint32(mehd.dataStart + 4, 0);
          view.setUint32(mehd.dataStart + 8, durationValue);
        } else {
          view.setUint32(mehd.dataStart + 4, durationValue);
        }
      }
    }

    return bytes;
  }

  function fix(blob, ext, seconds) {
    if (!blob || !blob.arrayBuffer || !seconds) return Promise.resolve(blob);

    return blob.arrayBuffer().then(function (buffer) {
      try {
        if (ext === 'webm') {
          return new Blob([fixWebm(buffer, seconds)], { type: 'video/webm' });
        }
        if (ext === 'mp4') {
          return new Blob([fixMp4(buffer, seconds)], { type: 'video/mp4' });
        }
      } catch (error) {
        // 修补失败就返回原文件
      }
      return blob;
    }).catch(function () {
      return blob;
    });
  }

  global.SkinDuration = { fix: fix };
})(window);
