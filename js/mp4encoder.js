(function (global) {
  'use strict';

  // 用 WebCodecs 逐帧离线编码 H.264，再自己封装成标准 MP4。
  // 时间戳固定为 i/fps，不会因为渲染速度掉帧；时长、关键帧都写在容器里。

  const MEDIA_TIMESCALE = 60000;

  function u16(value) {
    return Uint8Array.of((value >> 8) & 255, value & 255);
  }

  function u32(value) {
    return Uint8Array.of(
      (value >>> 24) & 255,
      (value >>> 16) & 255,
      (value >>> 8) & 255,
      value & 255
    );
  }

  function zeros(count) {
    return new Uint8Array(count);
  }

  function ascii(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
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

  function box(type, parts) {
    const payload = concat(parts || []);
    const head = new Uint8Array(8);
    const size = payload.length + 8;
    head[0] = (size >>> 24) & 255;
    head[1] = (size >>> 16) & 255;
    head[2] = (size >>> 8) & 255;
    head[3] = size & 255;
    head.set(ascii(type), 4);
    return concat([head, payload]);
  }

  function fullBox(type, version, flags, parts) {
    const head = Uint8Array.of(
      version,
      (flags >>> 16) & 255,
      (flags >>> 8) & 255,
      flags & 255
    );
    return box(type, [head].concat(parts || []));
  }

  function matrix() {
    const values = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
    const out = new Uint8Array(36);
    for (let i = 0; i < values.length; i++) {
      out.set(u32(values[i]), i * 4);
    }
    return out;
  }

  function buildMoov(info) {
    const movieDuration = Math.round(info.frameCount * 1000 / info.fps);

    const mvhd = fullBox('mvhd', 0, 0, [
      u32(0), u32(0),
      u32(1000), u32(movieDuration),
      u32(0x00010000),
      u16(0x0100), u16(0),
      u32(0), u32(0),
      matrix(),
      zeros(24),
      u32(2)
    ]);

    const tkhd = fullBox('tkhd', 0, 7, [
      u32(0), u32(0),
      u32(1), u32(0),
      u32(movieDuration),
      zeros(8),
      u16(0), u16(0), u16(0), u16(0),
      matrix(),
      u32(info.width * 65536),
      u32(info.height * 65536)
    ]);

    const mediaDuration = info.frameCount * info.sampleDelta;
    const mdhd = fullBox('mdhd', 0, 0, [
      u32(0), u32(0),
      u32(MEDIA_TIMESCALE), u32(mediaDuration),
      u16(0x55C4), u16(0)
    ]);

    const hdlr = fullBox('hdlr', 0, 0, [
      u32(0),
      ascii('vide'),
      zeros(12),
      ascii('VideoHandler\u0000')
    ]);

    const vmhd = fullBox('vmhd', 0, 1, [u16(0), u16(0), u16(0), u16(0)]);
    const dinf = box('dinf', [
      fullBox('dref', 0, 0, [u32(1), fullBox('url ', 0, 1, [])])
    ]);

    const avc1 = box('avc1', [
      zeros(6),
      u16(1),
      u16(0), u16(0), zeros(12),
      u16(info.width), u16(info.height),
      u32(0x00480000), u32(0x00480000),
      u32(0),
      u16(1),
      zeros(32),
      u16(0x0018),
      u16(0xffff),
      box('avcC', [info.description])
    ]);

    const stsd = fullBox('stsd', 0, 0, [u32(1), avc1]);
    const stts = fullBox('stts', 0, 0, [u32(1), u32(info.frameCount), u32(info.sampleDelta)]);

    // 硬件编码器可能输出 B 帧（解码顺序 ≠ 显示顺序），必须用 ctts 记录
    // 每一帧的显示时间偏移，否则播放时画面会一跳一跳
    let ctts = null;
    if (info.reordered) {
      const offsets = [];
      let negative = false;
      for (let i = 0; i < info.timestamps.length; i++) {
        const pts = Math.round(info.timestamps[i] * MEDIA_TIMESCALE / 1000000);
        const offset = pts - i * info.sampleDelta;
        if (offset < 0) negative = true;
        offsets.push(offset);
      }

      const entries = [];
      for (let i = 0; i < offsets.length; i++) {
        const last = entries[entries.length - 1];
        if (last && last[1] === offsets[i]) {
          last[0]++;
        } else {
          entries.push([1, offsets[i]]);
        }
      }

      const payload = [u32(entries.length)];
      for (let i = 0; i < entries.length; i++) {
        payload.push(u32(entries[i][0]));
        payload.push(u32(entries[i][1]));
      }
      ctts = fullBox('ctts', negative ? 1 : 0, 0, payload);
    }

    const stsc = fullBox('stsc', 0, 0, [u32(1), u32(1), u32(info.frameCount), u32(1)]);

    const keyframes = [];
    for (let i = 0; i < info.keys.length; i++) {
      if (info.keys[i]) keyframes.push(i + 1);
    }
    const stss = fullBox('stss', 0, 0, [u32(keyframes.length)].concat(keyframes.map(u32)));

    const sizes = new Uint8Array(info.sizes.length * 4);
    for (let i = 0; i < info.sizes.length; i++) {
      sizes.set(u32(info.sizes[i]), i * 4);
    }
    const stsz = fullBox('stsz', 0, 0, [u32(0), u32(info.frameCount), sizes]);

    const stco = fullBox('stco', 0, 0, [u32(1), u32(info.dataOffset)]);

    const stblParts = [stsd, stts];
    if (ctts) stblParts.push(ctts);
    stblParts.push(stss, stsc, stsz, stco);
    const stbl = box('stbl', stblParts);
    const minf = box('minf', [vmhd, dinf, stbl]);
    const mdia = box('mdia', [mdhd, hdlr, minf]);
    const trak = box('trak', [tkhd, mdia]);

    return box('moov', [mvhd, trak]);
  }

  function assemble(samples, description, width, height, fps, duration) {
    const sampleDelta = Math.round(MEDIA_TIMESCALE / fps);
    const sizes = [];
    const keys = [];
    const timestamps = [];
    const parts = [];

    let reordered = false;
    let lastTimestamp = -1;
    for (let i = 0; i < samples.length; i++) {
      sizes.push(samples[i].data.length);
      keys.push(!!samples[i].key);
      timestamps.push(samples[i].timestamp || 0);
      if (samples[i].timestamp < lastTimestamp) reordered = true;
      if (samples[i].timestamp > lastTimestamp) lastTimestamp = samples[i].timestamp;
      parts.push(samples[i].data);
    }

    const ftyp = box('ftyp', [ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41')]);

    let dataSize = 0;
    for (let i = 0; i < sizes.length; i++) dataSize += sizes[i];

    // moov 放在 mdat 前面（faststart），播放器不用读完整个文件才能开始
    const moovInfo = {
      width: width,
      height: height,
      fps: fps,
      frameCount: samples.length,
      sampleDelta: sampleDelta,
      sizes: sizes,
      keys: keys,
      timestamps: timestamps,
      reordered: reordered,
      description: description,
      dataOffset: 0
    };
    let moov = buildMoov(moovInfo);
    moovInfo.dataOffset = ftyp.length + moov.length + 8;
    moov = buildMoov(moovInfo);

    const mdatHead = new Uint8Array(8);
    const mdatSize = dataSize + 8;
    mdatHead[0] = (mdatSize >>> 24) & 255;
    mdatHead[1] = (mdatSize >>> 16) & 255;
    mdatHead[2] = (mdatSize >>> 8) & 255;
    mdatHead[3] = mdatSize & 255;
    mdatHead.set(ascii('mdat'), 4);

    return new Blob([ftyp, moov, mdatHead].concat(parts), { type: 'video/mp4' });
  }

  function supported() {
    return typeof global.VideoEncoder !== 'undefined'
      && typeof global.VideoFrame !== 'undefined';
  }

  async function pickConfig(width, height, fps, bitrate) {
    const codecs = width * height >= 6000000
      ? ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.640028']
      : ['avc1.64002a', 'avc1.640028', 'avc1.4d0028', 'avc1.42001f'];

    for (let i = 0; i < codecs.length; i++) {
      const config = {
        codec: codecs[i],
        width: width,
        height: height,
        bitrate: bitrate,
        framerate: fps,
        avc: { format: 'avc' },
        latencyMode: 'quality'
      };
      try {
        const support = await global.VideoEncoder.isConfigSupported(config);
        if (support && support.supported) return support.config || config;
      } catch (error) {
        // 试下一个编码档位
      }
    }
    return null;
  }

  // 用 MessageChannel 让出主线程：切到后台标签页时也不会被 setTimeout 节流
  const yieldChannel = new MessageChannel();
  let yieldResolve = null;
  yieldChannel.port1.onmessage = function () {
    const resolve = yieldResolve;
    yieldResolve = null;
    if (resolve) resolve();
  };

  function nextTick() {
    return new Promise(function (resolve) {
      yieldResolve = resolve;
      yieldChannel.port2.postMessage(0);
    });
  }

  async function encode(options) {
    if (!supported()) throw new Error('WebCodecs 不可用');

    const config = await pickConfig(options.width, options.height, options.fps, options.bitrate);
    if (!config) throw new Error('没有可用的 H.264 编码器');

    const frameCount = Math.max(1, Math.round(options.duration * options.fps));
    const frameDuration = Math.round(1000000 / options.fps);
    const samples = [];
    let description = null;
    let failure = null;

    const encoder = new global.VideoEncoder({
      output: function (chunk, metadata) {
        if (!description && metadata && metadata.decoderConfig && metadata.decoderConfig.description) {
          description = new Uint8Array(metadata.decoderConfig.description);
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        samples.push({ data: data, key: chunk.type === 'key', timestamp: chunk.timestamp });
      },
      error: function (error) {
        failure = error || new Error('视频编码失败');
      }
    });

    encoder.configure(config);

    try {
      let stalledSince = 0;

      for (let i = 0; i < frameCount; i++) {
        // 先等编码队列降下来再渲染下一帧，避免 4K 时帧堆积把内存吃满
        while (encoder.encodeQueueSize > 4) {
          if (failure) throw failure;
          if (!stalledSince) {
            stalledSince = performance.now();
          } else if (performance.now() - stalledSince > 30000) {
            throw new Error('编码器无响应');
          }
          await nextTick();
        }
        stalledSince = 0;
        if (failure) throw failure;

        options.render(i / options.fps);

        const frame = new global.VideoFrame(options.canvas, {
          timestamp: Math.round(i * 1000000 / options.fps),
          duration: frameDuration
        });
        encoder.encode(frame, {
          keyFrame: i === 0 || i % (options.fps * 2) === 0
        });
        frame.close();

        if (options.onProgress) {
          options.onProgress(0.02 + 0.9 * (i + 1) / frameCount);
        }

        if (i % 4 === 3) {
          await nextTick();
        }
      }

      await encoder.flush();
    } finally {
      try {
        encoder.close();
      } catch (error) {
        // ignore
      }
    }

    if (failure) throw failure;
    if (!description) throw new Error('编码器没有输出 SPS/PPS');
    if (!samples.length) throw new Error('编码结果为空');

    if (options.onProgress) options.onProgress(0.98);

    return assemble(
      samples,
      description,
      options.width,
      options.height,
      options.fps,
      options.duration
    );
  }

  global.SkinMp4 = {
    supported: supported,
    encode: encode
  };
})(window);
