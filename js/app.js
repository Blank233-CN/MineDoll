(function () {
  'use strict';

  const M4 = window.GLUtil.M4;

  // 《朋友的酒》约 120 BPM，一拍 0.5 秒
  const BEAT_SECONDS = 60 / 120;

  const canvas = document.getElementById('scene');
  const frame = document.getElementById('frame');
  const topbar = document.querySelector('.topbar');
  const dock = document.getElementById('dock');
  const statusText = document.getElementById('status-text');
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');
  const bgInput = document.getElementById('bg-input');
  const bgBtn = document.getElementById('bg-btn');
  const bgClear = document.getElementById('bg-clear');
  const musicBtn = document.getElementById('music-btn');
  const musicImport = document.getElementById('music-import');
  const musicImportLabel = document.getElementById('music-import-label');
  const musicDefault = document.getElementById('music-default');
  const audioInput = document.getElementById('audio-input');
  const bgPhoto = document.getElementById('bg-photo');
  const overlayToggle = document.getElementById('overlay-toggle');
  const armSelect = document.getElementById('arm-select');
  const fillSelect = document.getElementById('fill-select');
  const aspectSelect = document.getElementById('aspect-select');
  const sitBtn = document.getElementById('sit-btn');
  const bounceBtn = document.getElementById('bounce-btn');
  const resetBtn = document.getElementById('reset-btn');
  const modeStandard = document.getElementById('mode-standard');
  const modeDoll = document.getElementById('mode-doll');
  const layoutSingle = document.getElementById('layout-single');
  const layoutMulti = document.getElementById('layout-multi');
  const spinBtn = document.getElementById('spin-btn');
  const hint = document.getElementById('hint');
  const toast = document.getElementById('toast');
  const dropOverlay = document.getElementById('drop-overlay');
  const presetButtons = Array.prototype.slice.call(document.querySelectorAll('.preset'));
  const modelStrip = document.getElementById('model-strip');
  const exportBtn = document.getElementById('export-btn');
  const exportModal = document.getElementById('export-modal');
  const exportClose = document.getElementById('export-close');
  const exportBg = document.getElementById('export-bg');
  const exportQuality = document.getElementById('export-quality');
  const exportMp4 = document.getElementById('export-mp4');
  const exportGif = document.getElementById('export-gif');
  const exportImage = document.getElementById('export-image');
  const exportRatio = document.getElementById('export-ratio');
  const exportProgress = document.getElementById('export-progress');
  const exportBarFill = document.getElementById('export-bar-fill');
  const exportStatus = document.getElementById('export-status');
  const exportModeTip = document.getElementById('export-mode-tip');
  const exportAudio = document.getElementById('export-audio');
  const exportAudioTip = document.getElementById('export-audio-tip');
  const exportSubtitle = document.getElementById('export-subtitle');
  const moreBtn = document.getElementById('more-btn');
  const morePanel = document.getElementById('more-panel');
  const copyrightBtn = document.getElementById('copyright-btn');
  const copyrightModal = document.getElementById('copyright-modal');
  const copyrightClose = document.getElementById('copyright-close');
  const copyrightBackdrop = document.getElementById('copyright-backdrop');

  let renderer;
  try {
    renderer = new Skin3D.Renderer(canvas);
  } catch (error) {
    document.body.classList.add('no-webgl');
    return;
  }

  const state = {
    mode: 'normal',
    layout: 'multi',
    spin: false,
    spinAngle: 0,
    aspectMode: 'auto',
    aspect: 16 / 9,
    dollT: 0,
    sitT: 0,
    sitting: false,
    bounceOn: false,
    overlay: true,
    fill: 'auto',
    models: [],
    ringOrder: [],
    selectedId: null,
    nextId: 1
  };

  const FILL_COLORS = {
    black: [0, 0, 0],
    white: [1, 1, 1]
  };

  const EXPORT_QUALITY = {
    '1080': { width: 1920, height: 1080, fps: 60, bitrate: 12000000, label: '1080p60' },
    '4k': { width: 3840, height: 2160, fps: 60, bitrate: 40000000, label: '4k60' }
  };

  let exportQualityKey = '1080';

  const phys = {
    squash: 1,
    beatClock: 0,
    pulseTime: -1,
    pulseDuration: 0.42,
    pulseDepth: 0.4
  };

  const cam = {
    yaw: 0.55,
    pitch: 0.14,
    dist: 80,
    distTarget: 80,
    targetY: 16,
    userZoomed: false
  };

  let lastPose = null;
  let lastTime = 0;
  let toastTimer = 0;
  let exportBackground = 'white';
  let exportAudioOn = false;
  let exportImageRatio = '16:9';
  let exporting = false;
  let backgroundImage = null;
  let backgroundUrl = null;

  // ---------- helpers ----------

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('show');
    }, 2600);
  }

  function selectedModel() {
    for (let i = 0; i < state.models.length; i++) {
      if (state.models[i].id === state.selectedId) return state.models[i];
    }
    return state.models[0] || null;
  }

  function selectedIndex() {
    const model = selectedModel();
    return model ? state.models.indexOf(model) : 0;
  }

  // 单模型模式只渲染当前选中的模型，多模型模式渲染环形阵列
  function isSingleLayout() {
    return state.layout === 'single' && state.models.length > 0;
  }

  function layoutCount() {
    return isSingleLayout() ? 1 : state.models.length;
  }

  function slimOf(model) {
    if (!model) return false;
    if (model.meta.legacy) return false;
    if (model.armMode === 'auto') return model.autoSlim;
    return model.armMode === 'slim';
  }

  // 大范围镂空的皮肤默认用黑色补齐底图，避免看起来“隐身”
  function resolveFill(model) {
    if (!model) return null;
    const mode = state.fill === 'auto'
      ? (model.sparse ? 'black' : 'none')
      : state.fill;
    return FILL_COLORS[mode] || null;
  }

  function updateStatus() {
    const model = selectedModel();
    if (!model) return;
    const parts = [];
    if (state.models.length > 1) parts.push(state.models.length + ' 个模型');
    parts.push(model.meta.width + ' × ' + model.meta.height);
    parts.push(model.meta.legacy ? '旧版' : '标准');
    parts.push(slimOf(model) ? '纤细' : '经典');
    parts.push(state.overlay ? '双层' : '单层');
    statusText.textContent = parts.join(' · ');
  }

  function syncArmSelect() {
    const model = selectedModel();
    if (!model) return;
    armSelect.value = model.armMode;
    armSelect.disabled = model.meta.legacy;
    armSelect.title = model.meta.legacy ? '旧版皮肤仅包含经典手臂' : '';
  }

  // ---------- models ----------

  function createModel(result, name, isDefault) {
    return {
      id: 'm' + state.nextId++,
      name: name || '皮肤',
      canvas: result.canvas,
      meta: {
        width: result.width,
        height: result.legacy ? result.width / 2 : result.width,
        legacy: !!result.legacy
      },
      autoSlim: !!result.slim,
      sparse: !!result.sparse,
      holes: !!result.holes,
      armMode: 'auto',
      isDefault: !!isDefault,
      actor: renderer.createActor(result.canvas),
      layout: { x: 0, z: 0, scale: 1, angle: 0, radius: 0 }
    };
  }

  function addModel(result, name, select, isDefault) {
    const model = createModel(result, name, isDefault);
    state.models.push(model);
    if (select) state.selectedId = model.id;
    return model;
  }

  function addDefaultModel(select) {
    const result = window.Skin.normalize(window.Skin.createDefaultSkin());
    return addModel(result, '默认', select, true);
  }

  function removeModel(model) {
    const index = state.models.indexOf(model);
    if (index < 0) return;
    renderer.deleteActor(model.actor);
    state.models.splice(index, 1);

    if (!state.models.length) {
      state.selectedId = null;
      addDefaultModel(true);
    } else if (model.id === state.selectedId) {
      state.selectedId = state.models[Math.min(index, state.models.length - 1)].id;
    }
  }

  function selectModel(id) {
    if (id === state.selectedId) return;
    let found = null;
    for (let i = 0; i < state.models.length; i++) {
      if (state.models[i].id === id) found = state.models[i];
    }
    if (!found) return;

    const oldId = state.selectedId;
    state.selectedId = id;
    // 环整体转一格：新选中的离开环，旧的主模型排到环尾
    state.ringOrder = state.ringOrder.filter(function (item) {
      return item !== id;
    });
    if (oldId) state.ringOrder.push(oldId);

    syncArmSelect();
    updateStatus();
    renderModelChips();
  }

  function drawThumb(thumb, skin) {
    const ctx = thumb.getContext('2d');
    const scale = skin.width / 64;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, thumb.width, thumb.height);
    ctx.drawImage(skin, 8 * scale, 8 * scale, 8 * scale, 8 * scale, 0, 0, thumb.width, thumb.height);
  }

  // 只有存在大范围镂空的皮肤时，镂空填充才会有可见效果
  function syncFillControl() {
    let usable = false;
    for (let i = 0; i < state.models.length; i++) {
      if (state.models[i].holes) {
        usable = true;
        break;
      }
    }
    fillSelect.disabled = !usable;
    const wrap = document.getElementById('fill-wrap');
    if (wrap) {
      wrap.title = usable
        ? '透明像素的填充颜色'
        : '当前皮肤没有透明像素，切换镂空填充不会产生可见变化';
    }
  }

  function renderModelChips() {
    modelStrip.innerHTML = '';

    state.models.forEach(function (model) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'model-chip' + (model.id === state.selectedId ? ' active' : '');
      chip.dataset.id = model.id;
      chip.title = model.name;

      const thumb = document.createElement('canvas');
      thumb.width = 24;
      thumb.height = 24;
      drawThumb(thumb, model.canvas);
      chip.appendChild(thumb);

      const label = document.createElement('span');
      label.textContent = model.name;
      chip.appendChild(label);

      if (state.models.length > 1) {
        const remove = document.createElement('i');
        remove.className = 'model-x';
        remove.textContent = '×';
        remove.dataset.remove = model.id;
        chip.appendChild(remove);
      }

      modelStrip.appendChild(chip);
    });

    syncFillControl();
    syncSpinControl();
  }

  function cleanName(name) {
    const text = String(name || '皮肤').replace(/\.png$/i, '');
    return text.length > 8 ? text.slice(0, 8) + '…' : text;
  }

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('无法读取这张图片'));
      };
      img.src = url;
    });
  }

  async function loadFiles(fileList) {
    const files = Array.prototype.slice.call(fileList).filter(function (file) {
      return file && (file.type === 'image/png' || /\.png$/i.test(file.name || ''));
    });
    if (!files.length) {
      showToast('皮肤需要是 PNG 图片（64×64 或 64×32）');
      return;
    }

    const loaded = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const img = await loadImageFile(files[i]);
        const result = window.Skin.normalize(img);
        if (result.error) {
          showToast(result.error);
          continue;
        }
        loaded.push({ result: result, name: cleanName(files[i].name) });
      } catch (error) {
        showToast(error.message || '无法读取这张图片');
      }
    }
    if (!loaded.length) return;

    const pristineDefault = state.models.length === 1 && state.models[0].isDefault
      ? state.models[0]
      : null;

    let firstAdded = null;
    loaded.forEach(function (item) {
      const model = addModel(item.result, item.name, false, false);
      if (!firstAdded) firstAdded = model;
    });

    if (pristineDefault) removeModel(pristineDefault);

    state.selectedId = firstAdded.id;
    snapLayouts();
    snapCamera();
    syncArmSelect();
    updateStatus();
    renderModelChips();
    showToast('已导入 ' + loaded.length + ' 个模型');
  }

  function loadFile(file) {
    if (!file) return;
    loadFiles([file]);
  }

  function addPresetModel() {
    const presets = window.SKIN_PRESETS || [];
    const preset = presets[0];
    if (!preset || preset.type !== 'default') return;
    if (state.models.length === 1 && state.models[0].isDefault) {
      showToast('默认皮肤已经在场景里了');
      return;
    }
    const model = addDefaultModel(true);
    snapLayouts();
    snapCamera();
    syncArmSelect();
    updateStatus();
    renderModelChips();
    showToast('已添加默认皮肤');
    return model;
  }

  // ---------- layout ----------

  // 维护环上顺序：新导入的排在后面，被换下的主模型排到环尾
  function syncRingOrder() {
    const selected = selectedModel();
    const selectedId = selected ? selected.id : null;
    const next = [];

    const exists = function (id) {
      return state.models.some(function (model) {
        return model.id === id;
      });
    };

    state.ringOrder.forEach(function (id) {
      if (id !== selectedId && exists(id) && next.indexOf(id) < 0) next.push(id);
    });
    state.models.forEach(function (model) {
      if (model.id !== selectedId && next.indexOf(model.id) < 0) next.push(model.id);
    });

    state.ringOrder = next;
  }

  function layoutTargets() {
    syncRingOrder();
    const index = selectedIndex();
    const order = [];

    state.ringOrder.forEach(function (id) {
      const position = state.models.findIndex(function (model) {
        return model.id === id;
      });
      if (position >= 0 && position !== index) order.push(position);
    });

    return Skin3D.computeLayout(state.models.length, index, order);
  }

  function snapLayouts() {
    const targets = layoutTargets();
    state.models.forEach(function (model, index) {
      const target = targets[index];
      const radius = Math.hypot(target.x, target.z);
      model.layout.x = target.x;
      model.layout.z = target.z;
      model.layout.scale = target.scale;
      model.layout.radius = radius;
      model.layout.angle = radius > 0.001
        ? Math.atan2(target.x, target.z)
        : Skin3D.FRONT_ANGLE;
    });
  }

  // 模型越多，镜头抬得越高，避免前排挡住中间的主模型
  function groupPitch(count) {
    return 0.14 + Math.min(0.18, Math.max(0, count - 1) * 0.018);
  }

  // 模型数量变化时立刻把镜头拉到合适距离，避免还要等一段缩放动画
  function snapCamera() {
    const model = selectedModel();
    if (!model) return;
    const pose = Skin3D.computePose({
      dollT: state.dollT,
      sitT: state.sitT,
      slim: slimOf(model),
      squash: phys.squash
    });
    const aspect = canvas.width / Math.max(1, canvas.height);
    cam.distTarget = Skin3D.framingDistance(pose.totalHeight, layoutCount(), aspect);
    cam.dist = cam.distTarget;
    cam.targetY = pose.totalHeight * Skin3D.CENTER_SCALE * 0.5;
    cam.pitch = Math.max(cam.pitch, groupPitch(layoutCount()));
    cam.userZoomed = false;
  }

  function updateLayouts(dt) {
    const targets = layoutTargets();
    const ease = 1 - Math.exp(-dt * 10);
    const twoPi = Math.PI * 2;

    state.models.forEach(function (model, index) {
      const target = targets[index];
      const targetRadius = Math.hypot(target.x, target.z);
      // 中间的主模型统一收到镜头正前方，后排模型会绕着圈转到前面再放大
      const targetAngle = targetRadius > 0.001
        ? Math.atan2(target.x, target.z)
        : Skin3D.FRONT_ANGLE;

      let delta = targetAngle - model.layout.angle;
      delta = ((delta + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;

      model.layout.angle += delta * ease;
      model.layout.radius += (targetRadius - model.layout.radius) * ease;
      model.layout.scale += (target.scale - model.layout.scale) * ease;

      model.layout.x = Math.sin(model.layout.angle) * model.layout.radius;
      model.layout.z = Math.cos(model.layout.angle) * model.layout.radius;
    });
  }

  // ---------- export ----------

  function syncExportAudioUi() {
    const label = window.SkinAudio.label();
    const seconds = window.SkinAudio.duration();
    const length = seconds > 0 ? Math.round(seconds) + ' 秒' : '';

    exportSubtitle.textContent = exportAudioOn
      ? '附带音乐 · 视频时长自动匹配音乐'
      : '2 秒 / 4 拍 · 120 BPM · 无缝循环';

    exportAudioTip.textContent = exportAudioOn
      ? '将附带「' + label + '」' + (length ? '（约 ' + length + '）' : '')
        + '，视频时长自动匹配音乐；GIF 不支持音频。'
      : '选择「附带音乐」可把当前背景音乐封装进 MP4，视频时长自动匹配音乐；GIF 不支持音频。';

    Array.prototype.forEach.call(exportAudio.querySelectorAll('.chip'), function (chip) {
      chip.classList.toggle('active', (chip.dataset.audio === 'music') === exportAudioOn);
    });
  }

  function openExportModal() {
    if (!selectedModel() || exporting) return;

    exportProgress.hidden = true;
    exportBarFill.style.width = '0%';
    exportStatus.textContent = '准备中…';
    syncExportAudioUi();
    exportModal.classList.add('show');
    exportModal.setAttribute('aria-hidden', 'false');

    const tips = [];
    if (state.mode === 'doll' && state.bounceOn) {
      tips.push('当前：玩偶模式 · 弹跳开启，导出为完整的压缩循环。');
    } else if (state.mode === 'doll') {
      tips.push('当前：玩偶模式。开启「弹跳」后可导出压缩循环。');
    } else {
      tips.push('当前：标准模式，画面不会压缩；切到「玩偶」并开启「弹跳」效果更佳。');
    }
    if (isSingleLayout()) {
      tips.push(state.spin
        ? '当前：单模型 + 旋转，导出 4 秒转一圈（八拍）。'
        : '当前：单模型，只导出当前这一个模型；打开「旋转」可导出 4 秒转圈。');
    } else if (state.models.length > 1) {
      tips.push('MP4 会依次放大 ' + state.models.length + ' 个模型（每个 2 秒，共 '
        + state.models.length * 2 + ' 秒）；GIF 导出当前阵列，大模型保持不变。');
    }
    exportModeTip.textContent = tips.join(' ');

    const mp4 = window.SkinExporter.supportsMP4();
    exportMp4.textContent = mp4 ? '导出 MP4' : '导出 WebM';
    exportMp4.title = mp4 ? '' : '当前浏览器不支持 MP4 录制，将导出 WebM';

    setTimeout(function () {
      exportClose.focus();
    }, 30);
  }

  function closeExportModal() {
    if (exporting) return;
    exportModal.classList.remove('show');
    exportModal.setAttribute('aria-hidden', 'true');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 5000);
  }

  async function runExport(format) {
    const current = selectedModel();
    if (exporting || !current) return;

    exporting = true;
    exportModal.classList.add('busy');
    exportProgress.hidden = false;
    exportBarFill.style.width = '0%';
    exportStatus.textContent = '准备中…';

    try {
      const single = isSingleLayout();
      const list = single ? [current] : state.models;
      const spin = single && state.spin;
      const cycle = format === 'mp4' && list.length > 1;
      let duration = spin ? 4 : (cycle ? list.length * 2 : 2);
      let audioBuffer = null;

      // 附带音乐时，视频时长直接跟随音乐，导出完整一首 / 一整段旋律
      if (format === 'mp4' && exportAudioOn) {
        exportStatus.textContent = '准备音频…';
        const clip = await window.SkinAudio.exportClip();
        audioBuffer = clip.buffer;
        duration = clip.duration;
      }

      const isImage = format === 'image';
      const quality = EXPORT_QUALITY[exportQualityKey];
      const chosenBg = exportBackground === 'image' && !backgroundImage ? 'white' : exportBackground;
      const mp4Bg = chosenBg === 'transparent' ? 'white' : chosenBg;
      const imageParts = exportImageRatio.split(':');
      const imageAspect = Number(imageParts[0]) / Number(imageParts[1]);

      // 输出尺寸跟随画面比例：横屏 16:9 / 竖屏 9:16，与预览框完全一致
      let outWidth;
      let outHeight;
      if (isImage) {
        if (exportImageRatio === '1:1') {
          outWidth = quality.height;
          outHeight = quality.height;
        } else if (exportImageRatio === '9:16') {
          outWidth = quality.height;
          outHeight = quality.width;
        } else {
          outWidth = quality.width;
          outHeight = quality.height;
        }
      } else {
        const portrait = state.aspect < 1;
        outWidth = portrait ? quality.height : quality.width;
        outHeight = portrait ? quality.width : quality.height;
      }

      // 沿用预览里的环形顺序，保证导出的站位和编辑时一致
      const order = [];
      if (!single) {
        const currentIndex = state.models.indexOf(current);
        state.ringOrder.forEach(function (id) {
          const index = state.models.findIndex(function (model) {
            return model.id === id;
          });
          if (index >= 0 && index !== currentIndex) order.push(index);
        });
      }

      const payload = {
        models: list.map(function (model) {
          return {
            canvas: model.canvas,
            slim: slimOf(model),
            sparse: !!model.sparse
          };
        }),
        fill: state.fill,
        selectedIndex: list.indexOf(current),
        order: order,
        cycle: cycle,
        spin: spin,
        loop: 2,
        duration: duration,
        audio: format === 'mp4' ? audioBuffer : null,
        aspect: state.aspect,
        width: outWidth,
        height: outHeight,
        fps: quality.fps,
        bitrate: quality.bitrate,
        qualityLabel: quality.label,
        distance: isImage && Math.abs(imageAspect - state.aspect) >= 0.01 ? null : cam.dist,
        targetY: isImage && Math.abs(imageAspect - state.aspect) >= 0.01 ? null : cam.targetY,
        overlay: state.overlay,
        doll: state.mode === 'doll',
        sitting: state.sitting,
        bounce: state.bounceOn,
        yaw: cam.yaw,
        pitch: cam.pitch,
        background: format === 'mp4' ? mp4Bg : chosenBg,
        backgroundImage: chosenBg === 'image' ? backgroundImage : null,
        filename: isImage
          ? 'skinlab-still-' + exportImageRatio.replace(':', 'x') + '-' + outWidth + 'x' + outHeight + '.png'
          : undefined,
        onProgress: function (ratio, label) {
          exportBarFill.style.width = (ratio * 100).toFixed(1) + '%';
          exportStatus.textContent = label + ' · ' + Math.round(ratio * 100) + '%';
        }
      };

      let result;
      if (format === 'image') {
        exportStatus.textContent = '渲染图片…';
        result = await window.SkinExporter.exportImage(payload);
      } else if (format === 'mp4') {
        result = await window.SkinExporter.exportMP4(payload);
      } else {
        result = await window.SkinExporter.exportGIF(payload);
      }

      downloadBlob(result.blob, result.filename);
      exportBarFill.style.width = '100%';
      exportStatus.textContent = '完成 · ' + result.filename;
      showToast(result.fallback
        ? 'MP4 录制不可用，已导出 WebM'
        : '已导出 ' + result.filename);
    } catch (error) {
      exportStatus.textContent = '导出失败';
      showToast(error && error.message ? error.message : '导出失败');
    } finally {
      exporting = false;
      exportModal.classList.remove('busy');
    }
  }

  // ---------- modes ----------

  function syncDollControls() {
    const active = state.mode === 'doll';
    sitBtn.disabled = !active;
    bounceBtn.disabled = !active;
  }

  function syncSpinControl() {
    const single = isSingleLayout();
    spinBtn.disabled = !single;
    if (!single) {
      state.spin = false;
      state.spinAngle = 0;
      spinBtn.setAttribute('aria-pressed', 'false');
    }
  }

  function setLayoutMode(mode) {
    if (state.layout === mode) return;
    state.layout = mode;
    layoutSingle.classList.toggle('active', mode === 'single');
    layoutMulti.classList.toggle('active', mode === 'multi');
    layoutSingle.setAttribute('aria-pressed', String(mode === 'single'));
    layoutMulti.setAttribute('aria-pressed', String(mode === 'multi'));
    syncSpinControl();
    snapCamera();
    renderFrame();
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    syncDollControls();

    modeStandard.classList.toggle('active', mode === 'normal');
    modeDoll.classList.toggle('active', mode === 'doll');
    modeStandard.setAttribute('aria-pressed', String(mode === 'normal'));
    modeDoll.setAttribute('aria-pressed', String(mode === 'doll'));

    if (mode === 'normal') {
      state.sitting = false;
      state.bounceOn = false;
      sitBtn.setAttribute('aria-pressed', 'false');
      bounceBtn.setAttribute('aria-pressed', 'false');
    } else {
      phys.beatClock = 0;
      if (!state.bounceOn) {
        startPulse(0.34, 0.4);
      }
    }

    cam.userZoomed = false;
  }

  function setSitting(value) {
    if (state.mode !== 'doll') return;
    state.sitting = value;
    sitBtn.setAttribute('aria-pressed', String(value));
    if (!state.bounceOn) {
      startPulse(0.3, 0.36);
    }
    cam.userZoomed = false;
  }

  function setBounce(value) {
    if (state.mode !== 'doll') return;
    state.bounceOn = value;
    bounceBtn.setAttribute('aria-pressed', String(value));
    if (value) {
      phys.beatClock = 0;
      phys.pulseTime = -1;
    }
  }

  // ---------- squash animation ----------

  function startPulse(depth, duration) {
    phys.pulseTime = 0;
    phys.pulseDepth = depth;
    phys.pulseDuration = duration;
  }

  function updatePhysics(dt) {
    let target = 1;

    if (state.bounceOn) {
      phys.pulseTime = -1;
      phys.beatClock += dt;
      const beatIndex = Math.floor(phys.beatClock / BEAT_SECONDS);
      const phase = (phys.beatClock % BEAT_SECONDS) / BEAT_SECONDS;
      const depth = beatIndex % 4 === 0 ? 0.44 : 0.36;
      // 余弦包络：两端速度为 0，压缩与回弹都是缓入缓出
      target = 1 - depth * (0.5 - 0.5 * Math.cos(Math.PI * 2 * phase));
    } else if (phys.pulseTime >= 0) {
      phys.pulseTime += dt;
      const u = phys.pulseTime / phys.pulseDuration;
      if (u >= 1) {
        phys.pulseTime = -1;
        target = 1;
      } else {
        target = 1 - phys.pulseDepth * (0.5 - 0.5 * Math.cos(Math.PI * 2 * u));
      }
    }

    const ease = 1 - Math.exp(-dt * 28);
    phys.squash += (target - phys.squash) * ease;
    if (target === 1 && Math.abs(phys.squash - 1) < 0.0005) {
      phys.squash = 1;
    }
  }

  // ---------- camera & rendering ----------

  // 1:1 及以上算横屏，窄于 1:1 算竖屏
  function viewportAspect() {
    return window.innerWidth >= window.innerHeight ? 16 / 9 : 9 / 16;
  }

  function applyAspect(mode) {
    state.aspectMode = mode;
    state.aspect = mode === 'auto'
      ? viewportAspect()
      : (mode === '9:16' ? 9 / 16 : 16 / 9);
    aspectSelect.value = mode;
    layoutFrame();
    snapCamera();
    renderFrame();
  }

  // 画面区域按固定比例居中摆放，预览里看到的框就是导出的那一帧
  function layoutFrame() {
    const margin = 18;
    const top = Math.max(96, Math.round(topbar.getBoundingClientRect().bottom) + 16);
    const bottom = dock.getBoundingClientRect().top - 18;
    const availW = Math.max(120, window.innerWidth - margin * 2);
    const availH = Math.max(120, bottom - top);
    const ratio = state.aspect;
    let width = Math.min(availW, availH * ratio);
    let height = width / ratio;
    if (height > availH) {
      height = availH;
      width = height * ratio;
    }
    frame.style.width = Math.round(width) + 'px';
    frame.style.height = Math.round(height) + 'px';
    frame.style.left = Math.round((window.innerWidth - width) / 2) + 'px';
    frame.style.top = Math.round(top + (availH - height) / 2) + 'px';
    resize();
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(frame.clientWidth * dpr));
    const height = Math.max(1, Math.round(frame.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    renderer.setViewport(width, height);
  }

  function resetView() {
    cam.yaw = 0.55;
    cam.pitch = groupPitch(state.models.length);
    cam.userZoomed = false;
  }

  function update(dt) {
    const dollTarget = state.mode === 'doll' ? 1 : 0;
    state.dollT += (dollTarget - state.dollT) * (1 - Math.exp(-dt * 9));
    if (Math.abs(dollTarget - state.dollT) < 0.001) state.dollT = dollTarget;

    const sitTarget = state.sitting ? 1 : 0;
    state.sitT += (sitTarget - state.sitT) * (1 - Math.exp(-dt * 8));
    if (Math.abs(sitTarget - state.sitT) < 0.001) state.sitT = sitTarget;

    updatePhysics(dt);
    updateLayouts(dt);

    // 八拍一圈：120 BPM 下一拍 0.5 秒，8 拍正好 4 秒
    if (state.spin && isSingleLayout()) {
      state.spinAngle = (state.spinAngle + dt * Math.PI / 2) % (Math.PI * 2);
    } else if (!state.spin) {
      state.spinAngle = 0;
    }

    const model = selectedModel();
    if (!model) return;

    lastPose = Skin3D.computePose({
      dollT: state.dollT,
      sitT: state.sitT,
      slim: slimOf(model),
      squash: phys.squash
    });

    if (!cam.userZoomed) {
      const aspect = canvas.width / Math.max(1, canvas.height);
      cam.distTarget = Skin3D.framingDistance(lastPose.totalHeight, layoutCount(), aspect);
    }

    cam.dist += (cam.distTarget - cam.dist) * (1 - Math.exp(-dt * 10));
    cam.targetY += (
      lastPose.totalHeight * Skin3D.CENTER_SCALE * 0.5 - cam.targetY
    ) * (1 - Math.exp(-dt * 12));
  }

  function buildScene() {
    const actors = [];
    const shadows = [];
    const single = isSingleLayout();
    const list = single ? [selectedModel()] : state.models;
    const solo = single ? Skin3D.computeLayout(1, 0)[0] : null;
    const spinAngle = single && state.spin ? state.spinAngle : 0;

    list.forEach(function (model) {
      if (!model) return;
      const slim = slimOf(model);
      const pose = Skin3D.computePose({
        dollT: state.dollT,
        sitT: state.sitT,
        slim: slim,
        squash: phys.squash
      });
      const spot = single ? solo : model.layout;
      const scale = spot.scale;

      actors.push({
        actor: model.actor,
        pose: pose,
        slim: slim,
        fill: resolveFill(model),
        model: M4.chain(
          M4.translation(spot.x, 0, spot.z),
          M4.rotationY(spinAngle),
          M4.scaling(scale, scale, scale)
        )
      });

      const shadowScale = (10 + 2 * state.dollT) * scale / Math.sqrt(phys.squash);
      shadows.push({
        matrix: M4.chain(
          M4.translation(spot.x, 0.05, spot.z),
          M4.scaling(shadowScale, 1, shadowScale)
        ),
        alpha: 0.9 * (0.78 + 0.22 * Math.min(1, phys.squash))
      });
    });

    return { actors: actors, shadows: shadows, overlay: state.overlay };
  }

  function renderFrame() {
    if (!lastPose) return;

    const aspect = canvas.width / Math.max(1, canvas.height);
    const projection = M4.perspective(0.58, aspect, 0.5, 600);

    const eye = [
      cam.dist * Math.sin(cam.yaw) * Math.cos(cam.pitch),
      cam.targetY + cam.dist * Math.sin(cam.pitch),
      cam.dist * Math.cos(cam.yaw) * Math.cos(cam.pitch)
    ];
    const view = M4.lookAt(eye, [0, cam.targetY, 0], [0, 1, 0]);

    renderer.renderScene(buildScene(), projection, view);
  }

  function tick(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0.016;
    lastTime = now;
    update(dt);
    renderFrame();
    requestAnimationFrame(tick);
  }

  // ---------- input ----------

  // 每次点击让环整体转一格，下一个玩偶转到前面并放大
  function advanceSelection() {
    if (state.models.length < 2) return;
    const next = (selectedIndex() + 1) % state.models.length;
    selectModel(state.models[next].id);
  }

  const pointers = new Map();
  let drag = null;
  let pinch = null;

  canvas.addEventListener('pointerdown', function (event) {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      drag = {
        id: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: 0
      };
    } else if (pointers.size === 2) {
      drag = null;
      const pts = Array.from(pointers.values());
      pinch = {
        distance: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        zoom: cam.distTarget
      };
    }
  });

  canvas.addEventListener('pointermove', function (event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch && pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      cam.distTarget = clamp(pinch.zoom * (pinch.distance / Math.max(24, distance)), 38, 320);
      cam.userZoomed = true;
      return;
    }

    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);

      cam.yaw -= dx * 0.008;
      cam.pitch = clamp(cam.pitch + dy * 0.006, -0.35, 1.15);
    }
  });

  function endPointer(event) {
    if (drag && drag.id === event.pointerId && drag.moved < 8) {
      if (state.models.length > 1) {
        advanceSelection();
      } else if (state.mode === 'doll') {
        if (state.bounceOn) {
          phys.beatClock = 0;
        } else {
          startPulse(0.4, 0.46);
        }
      }
    }
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) drag = null;
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', function (event) {
    event.preventDefault();
    cam.distTarget = clamp(cam.distTarget * Math.exp(event.deltaY * 0.0012), 38, 320);
    cam.userZoomed = true;
  }, { passive: false });

  // ---------- UI wiring ----------

  uploadBtn.addEventListener('click', function () {
    fileInput.click();
  });

  bgBtn.addEventListener('click', function () {
    bgInput.click();
  });

  bgInput.addEventListener('change', function () {
    const file = bgInput.files && bgInput.files[0];
    bgInput.value = '';
    if (!file) return;
    if (!/^image\//i.test(file.type)) {
      showToast('背景需要是图片文件');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
      backgroundImage = img;
      backgroundUrl = url;
      bgPhoto.style.backgroundImage = 'url("' + url + '")';
      bgPhoto.classList.add('show');
      bgClear.hidden = false;
      bgBtn.textContent = '更换图片';
      // 导出默认跟随预览使用这张背景图
      exportBackground = 'image';
      Array.prototype.forEach.call(exportBg.querySelectorAll('.chip'), function (item) {
        item.classList.toggle('active', item.dataset.bg === 'image');
      });
      showToast('已设置背景图');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      showToast('无法读取这张背景图');
    };
    img.src = url;
  });

  bgClear.addEventListener('click', function () {
    backgroundImage = null;
    if (backgroundUrl) {
      URL.revokeObjectURL(backgroundUrl);
      backgroundUrl = null;
    }
    bgPhoto.style.backgroundImage = 'none';
    bgPhoto.classList.remove('show');
    bgClear.hidden = true;
    bgBtn.textContent = '选择图片';
    if (exportBackground === 'image') {
      exportBackground = 'white';
      Array.prototype.forEach.call(exportBg.querySelectorAll('.chip'), function (item) {
        item.classList.toggle('active', item.dataset.bg === 'white');
      });
    }
  });

  function syncMusicUi() {
    const playing = window.SkinAudio.isPlaying();
    musicBtn.setAttribute('aria-pressed', String(playing));
    const custom = window.SkinAudio.source() === 'file';
    musicImportLabel.textContent = custom ? '更换音频' : '导入音频';
    musicDefault.hidden = !custom;
  }

  window.SkinAudio.onState = syncMusicUi;

  musicBtn.addEventListener('click', function () {
    window.SkinAudio.toggle();
  });

  musicImport.addEventListener('click', function () {
    audioInput.click();
  });

  audioInput.addEventListener('change', function () {
    const file = audioInput.files && audioInput.files[0];
    audioInput.value = '';
    if (!file) return;
    const isAudio = /^audio\//i.test(file.type)
      || /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file.name);
    if (!isAudio) {
      showToast('请选择音频文件');
      return;
    }
    window.SkinAudio.setFile(file);
    showToast('背景音乐：' + window.SkinAudio.label());
  });

  musicDefault.addEventListener('click', function () {
    window.SkinAudio.clearFile();
    showToast('已切回默认旋律');
  });

  // 音乐开始时把弹跳节拍对齐到第一拍
  document.addEventListener('skinlab:musicstart', function () {
    phys.beatClock = 0;
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length) {
      loadFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  overlayToggle.addEventListener('change', function () {
    state.overlay = overlayToggle.checked;
    updateStatus();
  });

  armSelect.addEventListener('change', function () {
    const model = selectedModel();
    if (!model) return;
    model.armMode = armSelect.value;
    updateStatus();
  });

  fillSelect.addEventListener('change', function () {
    state.fill = fillSelect.value;
  });

  aspectSelect.addEventListener('change', function () {
    applyAspect(aspectSelect.value);
  });

  function setMoreOpen(open) {
    morePanel.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
  }

  moreBtn.addEventListener('click', function (event) {
    event.stopPropagation();
    setMoreOpen(morePanel.hidden);
  });

  document.addEventListener('click', function (event) {
    if (morePanel.hidden) return;
    if (morePanel.contains(event.target) || moreBtn.contains(event.target)) return;
    setMoreOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !morePanel.hidden) setMoreOpen(false);
  });

  sitBtn.addEventListener('click', function () {
    setSitting(!state.sitting);
  });

  bounceBtn.addEventListener('click', function () {
    setBounce(!state.bounceOn);
  });

  resetBtn.addEventListener('click', resetView);

  layoutSingle.addEventListener('click', function () {
    setLayoutMode('single');
  });

  layoutMulti.addEventListener('click', function () {
    setLayoutMode('multi');
  });

  spinBtn.addEventListener('click', function () {
    if (!isSingleLayout()) return;
    state.spin = !state.spin;
    spinBtn.setAttribute('aria-pressed', String(state.spin));
  });

  modeStandard.addEventListener('click', function () {
    setMode('normal');
  });

  modeDoll.addEventListener('click', function () {
    setMode('doll');
  });

  presetButtons.forEach(function (button) {
    button.addEventListener('click', addPresetModel);
  });

  modelStrip.addEventListener('click', function (event) {
    const removeId = event.target.dataset ? event.target.dataset.remove : null;
    if (removeId) {
      event.stopPropagation();
      let target = null;
      for (let i = 0; i < state.models.length; i++) {
        if (state.models[i].id === removeId) target = state.models[i];
      }
      if (target) {
        removeModel(target);
        snapLayouts();
        snapCamera();
        syncArmSelect();
        updateStatus();
        renderModelChips();
      }
      return;
    }

    const chip = event.target.closest ? event.target.closest('.model-chip') : null;
    if (chip) selectModel(chip.dataset.id);
  });

  exportBtn.addEventListener('click', openExportModal);
  exportClose.addEventListener('click', closeExportModal);

  document.querySelector('.export-backdrop').addEventListener('click', closeExportModal);

  Array.prototype.forEach.call(exportBg.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      if (exporting) return;
      if (chip.dataset.bg === 'image' && !backgroundImage) {
        showToast('先点「背景图」导入一张图片');
        return;
      }
      exportBackground = chip.dataset.bg;
      Array.prototype.forEach.call(exportBg.querySelectorAll('.chip'), function (item) {
        item.classList.toggle('active', item === chip);
      });
    });
  });

  Array.prototype.forEach.call(exportQuality.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      if (exporting) return;
      exportQualityKey = chip.dataset.quality;
      Array.prototype.forEach.call(exportQuality.querySelectorAll('.chip'), function (item) {
        item.classList.toggle('active', item === chip);
      });
    });
  });

  Array.prototype.forEach.call(exportAudio.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      if (exporting) return;
      exportAudioOn = chip.dataset.audio === 'music';
      syncExportAudioUi();
    });
  });

  Array.prototype.forEach.call(exportRatio.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      if (exporting) return;
      exportImageRatio = chip.dataset.ratio;
      Array.prototype.forEach.call(exportRatio.querySelectorAll('.chip'), function (item) {
        item.classList.toggle('active', item === chip);
      });
    });
  });

  exportMp4.addEventListener('click', function () {
    runExport('mp4');
  });

  exportGif.addEventListener('click', function () {
    runExport('gif');
  });

  exportImage.addEventListener('click', function () {
    runExport('image');
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && exportModal.classList.contains('show')) {
      closeExportModal();
    }
  });

  function openCopyright() {
    copyrightModal.classList.add('show');
    copyrightModal.setAttribute('aria-hidden', 'false');
    setTimeout(function () {
      copyrightClose.focus();
    }, 30);
  }

  function closeCopyright() {
    copyrightModal.classList.remove('show');
    copyrightModal.setAttribute('aria-hidden', 'true');
    copyrightBtn.focus();
  }

  copyrightBtn.addEventListener('click', openCopyright);
  copyrightClose.addEventListener('click', closeCopyright);
  copyrightBackdrop.addEventListener('click', closeCopyright);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && copyrightModal.classList.contains('show')) {
      closeCopyright();
    }
  });

  let dragDepth = 0;

  window.addEventListener('dragenter', function (event) {
    event.preventDefault();
    dragDepth++;
    dropOverlay.classList.add('show');
  });

  window.addEventListener('dragover', function (event) {
    event.preventDefault();
  });

  window.addEventListener('dragleave', function (event) {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      dropOverlay.classList.remove('show');
    }
  });

  window.addEventListener('drop', function (event) {
    event.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('show');
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) loadFiles(files);
  });

  window.addEventListener('resize', function () {
    if (state.aspectMode === 'auto') {
      state.aspect = viewportAspect();
    }
    layoutFrame();
    renderFrame();
  });

  // 工具栏换行、玩偶模式多出按钮时，画面区域要重新居中
  if (window.ResizeObserver) {
    const frameObserver = new ResizeObserver(function () {
      layoutFrame();
    });
    frameObserver.observe(dock);
    frameObserver.observe(topbar);
  }

  // ---------- boot ----------

  state.aspect = viewportAspect();
  aspectSelect.value = 'auto';
  layoutFrame();
  addDefaultModel(true);
  snapLayouts();
  renderModelChips();
  syncArmSelect();
  updateStatus();
  syncDollControls();
  syncSpinControl();
  syncMusicUi();
  hint.textContent = '拖拽旋转 · 滚轮缩放 · 点击切换玩偶';

  update(0.016);
  renderFrame();
  requestAnimationFrame(tick);
})();
