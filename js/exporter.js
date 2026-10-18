(function (global) {
  'use strict';

  const M4 = global.GLUtil.M4;
  const BEAT_SECONDS = 60 / 120;
  const FOV = 0.58;
  const TRANSITION = 0.8;
  const TAU = Math.PI * 2;

  function squashAt(time) {
    const phase = (time % BEAT_SECONDS) / BEAT_SECONDS;
    const beat = Math.floor(time / BEAT_SECONDS);
    const depth = beat % 4 === 0 ? 0.44 : 0.36;
    return 1 - depth * (0.5 - 0.5 * Math.cos(Math.PI * 2 * phase));
  }

  // 背景图按 cover 铺满画布
  function drawCover(ctx, image, width, height) {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih) return;
    const scale = Math.max(width / iw, height / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }

  function fillOf(options, model) {
    const mode = options.fill === 'auto'
      ? (model.sparse ? 'black' : 'none')
      : (options.fill || 'none');
    if (mode === 'black') return [0, 0, 0];
    if (mode === 'white') return [1, 1, 1];
    return null;
  }

  function createSurface(options, width, height) {
    const glCanvas = document.createElement('canvas');
    glCanvas.width = width;
    glCanvas.height = height;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const ctx = outCanvas.getContext('2d', { willReadFrequently: true });

    // 导出分辨率高，关闭 MSAA 换取更稳定的 60fps
    const renderer = new Skin3D.Renderer(glCanvas, { antialias: false });
    renderer.setViewport(width, height);

    const actors = options.models.map(function (model) {
      return {
        actor: renderer.createActor(model.canvas),
        slim: !!model.slim,
        fill: fillOf(options, model)
      };
    });

    return {
      width: width,
      height: height,
      glCanvas: glCanvas,
      outCanvas: outCanvas,
      ctx: ctx,
      renderer: renderer,
      actors: actors
    };
  }

  function disposeSurface(surface) {
    try {
      const ext = surface.renderer.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    } catch (error) {
      // ignore
    }
  }

  function toPolar(layout) {
    return layout.map(function (spot) {
      const radius = Math.hypot(spot.x, spot.z);
      return {
        angle: radius > 0.001 ? Math.atan2(spot.x, spot.z) : Skin3D.FRONT_ANGLE,
        radius: radius,
        scale: spot.scale
      };
    });
  }

  function blendLayout(from, to, u) {
    return from.map(function (a, index) {
      const b = to[index];
      let delta = b.angle - a.angle;
      delta = ((delta + Math.PI) % TAU + TAU) % TAU - Math.PI;
      const angle = a.angle + delta * u;
      const radius = a.radius + (b.radius - a.radius) * u;
      return {
        x: Math.sin(angle) * radius,
        z: Math.cos(angle) * radius,
        scale: a.scale + (b.scale - a.scale) * u
      };
    });
  }

  // 环上顺序按当前主模型循环排列，保证每次切换整圈转一格
  function cyclicOrder(count, big) {
    const order = [];
    for (let i = 1; i < count; i++) {
      order.push((big + i) % count);
    }
    return order;
  }

  // 按预览里的环形顺序排布；segment 表示主模型已经前进了几格
  function layoutFor(count, entry, order, segment) {
    if (count <= 1) {
      return Skin3D.computeLayout(count, entry, null);
    }
    if (!order || !order.length) {
      const big = (entry + segment) % count;
      return Skin3D.computeLayout(count, big, cyclicOrder(count, big));
    }

    const full = [entry].concat(order);
    const n = full.length;
    const offset = ((segment % n) + n) % n;
    const rotated = full.slice(offset).concat(full.slice(0, offset));
    return Skin3D.computeLayout(count, rotated[0], rotated.slice(1));
  }

  function drawFrame(surface, options, time) {
    const squash = options.bounce ? squashAt(time) : 1;
    const count = surface.actors.length;
    const loop = options.loop || 2;
    const entry = options.selectedIndex || 0;

    // 每 loop 秒换一个大模型，切换前 TRANSITION 秒用旋转过渡转到正前方
    let layout;
    if (options.cycle && count > 1) {
      const segment = Math.floor(time / loop);
      const phase = time - segment * loop;
      const current = layoutFor(count, entry, options.order, segment);

      if (phase <= loop - TRANSITION) {
        layout = current;
      } else {
        const next = layoutFor(count, entry, options.order, segment + 1);
        const u0 = (phase - (loop - TRANSITION)) / TRANSITION;
        const u = 0.5 - 0.5 * Math.cos(Math.PI * u0);
        layout = blendLayout(toPolar(current), toPolar(next), u);
      }
    } else {
      layout = layoutFor(count, entry, options.order, 0);
    }

    const actors = [];
    const shadows = [];
    let totalHeight = 0;
    // 单模型旋转：八拍一圈，4 秒正好 360°
    const spinAngle = options.spin ? (time / 4) * Math.PI * 2 : 0;

    for (let i = 0; i < count; i++) {
      const item = surface.actors[i];
      const pose = Skin3D.computePose({
        dollT: options.doll ? 1 : 0,
        sitT: options.sitting ? 1 : 0,
        slim: item.slim,
        squash: squash
      });
      const spot = layout[i];
      totalHeight = Math.max(totalHeight, pose.totalHeight);

      actors.push({
        actor: item.actor,
        pose: pose,
        slim: item.slim,
        fill: item.fill,
        model: M4.chain(
          M4.translation(spot.x, 0, spot.z),
          M4.rotationY(spinAngle),
          M4.scaling(spot.scale, spot.scale, spot.scale)
        )
      });

      const shadowScale = (10 + (options.doll ? 2 : 0)) * spot.scale / Math.sqrt(squash);
      shadows.push({
        matrix: M4.chain(
          M4.translation(spot.x, 0.05, spot.z),
          M4.scaling(shadowScale, 1, shadowScale)
        ),
        alpha: options.background === 'transparent' && !options.backgroundImage
          ? 0
          : 0.9 * (0.78 + 0.22 * Math.min(1, squash))
      });
    }

    const aspect = surface.width / Math.max(1, surface.height);
    // 视频使用预览时的相机参数，保证视角完全一致
    const targetY = options.targetY != null
      ? options.targetY
      : totalHeight * Skin3D.CENTER_SCALE * 0.5;
    const distance = options.distance != null
      ? options.distance
      : Skin3D.framingDistance(totalHeight, count, aspect);
    const eye = [
      distance * Math.sin(options.yaw) * Math.cos(options.pitch),
      targetY + distance * Math.sin(options.pitch),
      distance * Math.cos(options.yaw) * Math.cos(options.pitch)
    ];
    const projection = M4.perspective(FOV, aspect, 0.5, 600);
    const view = M4.lookAt(eye, [0, targetY, 0], [0, 1, 0]);

    surface.renderer.renderScene({
      actors: actors,
      shadows: shadows,
      overlay: !!options.overlay
    }, projection, view);

    surface.ctx.clearRect(0, 0, surface.width, surface.height);
    if (options.backgroundImage) {
      drawCover(surface.ctx, options.backgroundImage, surface.width, surface.height);
    } else if (options.background === 'white') {
      surface.ctx.fillStyle = '#ffffff';
      surface.ctx.fillRect(0, 0, surface.width, surface.height);
    }
    surface.ctx.drawImage(surface.glCanvas, 0, 0);
  }

  const MP4_MIMES = [
    'video/mp4',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1'
  ];
  const WEBM_MIMES = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];

  function videoCandidates() {
    const list = [];
    if (typeof MediaRecorder === 'undefined') return list;
    for (let i = 0; i < MP4_MIMES.length; i++) {
      if (MediaRecorder.isTypeSupported(MP4_MIMES[i])) {
        list.push({ mime: MP4_MIMES[i], ext: 'mp4' });
      }
    }
    for (let i = 0; i < WEBM_MIMES.length; i++) {
      if (MediaRecorder.isTypeSupported(WEBM_MIMES[i])) {
        list.push({ mime: WEBM_MIMES[i], ext: 'webm' });
      }
    }
    return list;
  }

  function supportsMP4() {
    if (global.SkinMp4 && global.SkinMp4.supported()) return true;
    return videoCandidates().some(function (format) {
      return format.ext === 'mp4';
    });
  }

  function nextTick() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function frameSettings(options) {
    return {
      models: options.models,
      selectedIndex: options.selectedIndex || 0,
      order: options.order || null,
      cycle: !!options.cycle,
      loop: options.loop || 2,
      overlay: options.overlay,
      doll: options.doll,
      sitting: options.sitting,
      bounce: options.bounce,
      yaw: options.yaw,
      pitch: options.pitch,
      background: options.background || 'white',
      backgroundImage: options.backgroundImage || null,
      spin: !!options.spin,
      distance: options.distance,
      targetY: options.targetY
    };
  }

  // 优先走 WebCodecs 离线编码：帧时间固定，不会掉帧，输出一定是 MP4
  function recordWithWebCodecs(options) {
    const width = options.width || 1920;
    const height = options.height || 1080;
    const fps = options.fps || 60;
    const surface = createSurface(options, width, height);
    const settings = frameSettings(options);

    return global.SkinMp4.encode({
      canvas: surface.outCanvas,
      width: width,
      height: height,
      fps: fps,
      duration: options.duration || 2,
      bitrate: options.bitrate || 12000000,
      render: function (time) {
        drawFrame(surface, settings, time);
      },
      onProgress: function (ratio) {
        options.onProgress(ratio, '编码视频');
      }
    }).then(function (blob) {
      disposeSurface(surface);
      return blob;
    }, function (error) {
      disposeSurface(surface);
      throw error;
    });
  }

  function recordVideo(format, options) {
    const width = options.width || 1920;
    const height = options.height || 1080;
    const fps = options.fps || 60;
    const bitrate = options.bitrate || 12000000;
    const duration = options.duration || 2;
    const surface = createSurface(options, width, height);
    const settings = frameSettings(options);

    return new Promise(function (resolve, reject) {
      let settled = false;
      let recorder = null;
      let stream = null;
      const chunks = [];

      function cleanup() {
        try {
          if (stream) {
            stream.getTracks().forEach(function (track) { track.stop(); });
          }
        } catch (error) {
          // ignore
        }
        disposeSurface(surface);
      }

      function fail(error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }

      try {
        drawFrame(surface, settings, 0);

        stream = surface.outCanvas.captureStream(fps);
        recorder = new MediaRecorder(stream, {
          mimeType: format.mime,
          videoBitsPerSecond: bitrate
        });

        recorder.ondataavailable = function (event) {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onerror = function () {
          fail(new Error('视频编码失败'));
        };
        recorder.onstop = function () {
          if (settled) return;
          const blob = new Blob(chunks, { type: format.mime.split(';')[0] });
          if (blob.size < 2048) {
            fail(new Error('视频编码结果为空'));
            return;
          }
          global.SkinDuration.fix(blob, format.ext, duration).then(function (fixed) {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(fixed);
          });
        };

        recorder.start(100);
      } catch (error) {
        fail(error);
        return;
      }

      const start = performance.now();
      function step(now) {
        if (settled) return;
        const elapsed = Math.min(duration, Math.max(0, (now - start) / 1000));
        drawFrame(surface, settings, elapsed);
        options.onProgress(Math.min(1, elapsed / duration), '录制视频');

        if (elapsed >= duration) {
          try {
            recorder.stop();
          } catch (error) {
            fail(error);
          }
          return;
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  function exportBaseName(options) {
    const multi = options.models.length > 1;
    return 'skinlab-' + (multi ? 'multi' : 'loop') + '-'
      + (options.qualityLabel || '1080p60');
  }

  function exportWithMediaRecorder(options) {
    const formats = videoCandidates();
    if (!formats.length) {
      return Promise.reject(new Error('当前浏览器不支持视频录制'));
    }

    function attempt(index) {
      return recordVideo(formats[index], options).then(function (blob) {
        const format = formats[index];
        return {
          blob: blob,
          filename: exportBaseName(options) + '.' + format.ext,
          ext: format.ext,
          fallback: format.ext !== 'mp4'
        };
      }).catch(function (error) {
        if (index + 1 < formats.length) {
          options.onProgress(0, '更换编码重试…');
          return attempt(index + 1);
        }
        throw error;
      });
    }

    return attempt(0);
  }

  function exportMP4(options) {
    if (global.SkinMp4 && global.SkinMp4.supported()) {
      return recordWithWebCodecs(options).then(function (blob) {
        return {
          blob: blob,
          filename: exportBaseName(options) + '.mp4',
          ext: 'mp4',
          fallback: false
        };
      }).catch(function () {
        options.onProgress(0, '改用实时录制…');
        return exportWithMediaRecorder(options);
      });
    }
    return exportWithMediaRecorder(options);
  }

  async function exportGIF(options) {
    // GIF 固定输出正方形，方便直接当表情包用
    const width = 480;
    const height = 480;
    const fps = 25;
    const duration = options.duration || 2;
    const frameCount = Math.round(duration * fps);
    const transparent = options.background === 'transparent';
    const surface = createSurface(options, width, height);

    const settings = {
      models: options.models,
      selectedIndex: options.selectedIndex || 0,
      order: options.order || null,
      cycle: false,
      loop: options.loop || 2,
      overlay: options.overlay,
      doll: options.doll,
      sitting: options.sitting,
      bounce: options.bounce,
      yaw: options.yaw,
      pitch: options.pitch,
      background: options.background,
      backgroundImage: options.backgroundImage || null,
      spin: !!options.spin,
      // 正方形画面重新取景，不沿用横/竖屏的相机距离
      distance: null,
      targetY: null
    };

    try {
      const histogram = new Uint32Array(32768);
      for (let i = 0; i < frameCount; i++) {
        drawFrame(surface, settings, i / fps);
        const data = surface.ctx.getImageData(0, 0, width, height).data;
        for (let p = 0; p < data.length; p += 4) {
          if (transparent && data[p + 3] < 128) continue;
          histogram[((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3)]++;
        }
        options.onProgress(0.45 * (i + 1) / frameCount, '分析颜色');
        if (i % 4 === 3) await nextTick();
      }

      const colors = global.GifPalette.build(histogram, transparent);
      const writer = new global.GifWriter(width, height, colors.palette, transparent ? 0 : -1);
      writer.start(0);

      const indices = new Uint8Array(width * height);
      for (let i = 0; i < frameCount; i++) {
        drawFrame(surface, settings, i / fps);
        const data = surface.ctx.getImageData(0, 0, width, height).data;
        for (let p = 0, q = 0; p < data.length; p += 4, q++) {
          if (transparent && data[p + 3] < 128) {
            indices[q] = 0;
          } else {
            indices[q] = colors.lookup[
              ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3)
            ];
          }
        }
        writer.addFrame(indices, Math.round(100 / fps));
        options.onProgress(0.45 + 0.55 * (i + 1) / frameCount, '编码 GIF');
        if (i % 2 === 1) await nextTick();
      }

      const blob = writer.finish();
      return {
        blob: blob,
        filename: 'skinlab-loop-' + (transparent ? 'transparent' : 'white') + '.gif',
        ext: 'gif'
      };
    } finally {
      disposeSurface(surface);
    }
  }

  global.SkinExporter = {
    supportsMP4: supportsMP4,
    exportMP4: exportMP4,
    exportGIF: exportGIF
  };
})(window);
