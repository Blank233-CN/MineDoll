(function (global) {
  'use strict';

  const LEGACY_RATIO = 2; // 64 x 32

  function createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { canvas: canvas, ctx: ctx };
  }

  function mirrorFace(ctx, src, dst) {
    const tmp = createCanvas(src[2], src[3]);
    tmp.ctx.drawImage(ctx.canvas, src[0], src[1], src[2], src[3], 0, 0, src[2], src[3]);
    ctx.save();
    ctx.translate(dst[0] + dst[2], dst[1]);
    ctx.scale(-1, 1);
    ctx.drawImage(tmp.canvas, 0, 0);
    ctx.restore();
  }

  /**
   * Legacy skins have no left limbs. Mirror the right limbs face by face into
   * the modern left-limb regions — flipping the whole 16x16 block would move
   * the front/side/back faces to the wrong places.
   */
  function mirrorLimb(ctx, srcU, srcV, dstU, dstV, slim, scale) {
    const d = 4 * scale;
    const h = 12 * scale;
    const w = (slim ? 3 : 4) * scale;
    const su = srcU * scale;
    const sv = srcV * scale;
    const du = dstU * scale;
    const dv = dstV * scale;

    // Source: right limb
    const srcOuter = [su, sv + d, d, h];
    const srcFront = [su + d, sv + d, w, h];
    const srcInner = [su + d + w, sv + d, d, h];
    const srcBack = [su + d + w + d, sv + d, w, h];
    const srcTop = [su + d, sv, w, d];
    const srcBottom = [su + d + w, sv, w, d];

    // Destination: left limb, inner/outer sides swap
    const dstOuter = [du + d + w, dv + d, d, h];
    const dstFront = [du + d, dv + d, w, h];
    const dstInner = [du, dv + d, d, h];
    const dstBack = [du + d + w + d, dv + d, w, h];
    const dstTop = [du + d, dv, w, d];
    const dstBottom = [du + d + w, dv, w, d];

    mirrorFace(ctx, srcOuter, dstOuter);
    mirrorFace(ctx, srcFront, dstFront);
    mirrorFace(ctx, srcInner, dstInner);
    mirrorFace(ctx, srcBack, dstBack);
    mirrorFace(ctx, srcTop, dstTop);
    mirrorFace(ctx, srcBottom, dstBottom);
  }

  function blockHasPixels(data, width, x, y, size) {
    for (let py = y; py < y + size; py++) {
      for (let px = x; px < x + size; px++) {
        if (data[(py * width + px) * 4 + 3] > 8) {
          return true;
        }
      }
    }
    return false;
  }

  // 统计真正参与渲染的贴图块里的透明像素（镂空皮肤）
  function countHoles(ctx, side, scale) {
    // 只检查基础层；帽子层可以为空，不算镂空
    const blocks = [
      [0, 0, 32, 16],
      [16, 16, 24, 16],
      [40, 16, 16, 16],
      [0, 16, 16, 16],
      [32, 48, 16, 16],
      [16, 48, 16, 16]
    ];
    const data = ctx.getImageData(0, 0, side, side).data;
    let holes = 0;

    for (let b = 0; b < blocks.length; b++) {
      const x0 = Math.round(blocks[b][0] * scale);
      const y0 = Math.round(blocks[b][1] * scale);
      const x1 = Math.round((blocks[b][0] + blocks[b][2]) * scale);
      const y1 = Math.round((blocks[b][1] + blocks[b][3]) * scale);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (data[(y * side + x) * 4 + 3] < 8) holes++;
        }
      }
    }
    return holes;
  }

  function detectSlim(ctx, scale, rightOnly) {
    const px = (x, y) => {
      const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
      return d[3];
    };
    let score = 0;
    if (px(55, 20) < 8) score++;
    if (px(54, 20) < 8) score++;
    if (rightOnly) return score === 2;
    if (px(47, 52) < 8) score++;
    if (px(46, 52) < 8) score++;
    return score >= 2;
  }

  /**
   * Normalize any supported Minecraft skin into a modern 64x64-layout canvas
   * (at its native pixel scale, so 128x128 HD skins stay crisp).
   */
  function normalize(source) {
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;

    if (!width || !height) {
      return { error: '无法读取图片尺寸' };
    }

    const modern = width === height && width >= 64 && width % 64 === 0;
    const legacy = width === height * LEGACY_RATIO && width >= 64 && width % 64 === 0;

    if (!modern && !legacy) {
      return { error: '皮肤尺寸需为 64×64、64×32 或其整数倍（如 128×128）' };
    }

    const side = width;
    const out = createCanvas(side, side);
    const ctx = out.ctx;
    const scale = side / 64;

    ctx.clearRect(0, 0, side, side);

    let slim = false;
    let sparse = false;

    if (legacy) {
      ctx.drawImage(source, 0, 0, width, height, 0, 0, width, height);
      // 64x32 has no hat layer — the top-right 32x16 block often still holds
      // editor leftovers, which would otherwise render as a stray overlay.
      ctx.clearRect(32 * scale, 0, 32 * scale, 16 * scale);
      // Legacy skins only contain the right limbs — mirror them face by face.
      mirrorLimb(ctx, 0, 16, 16, 48, false, scale);
      mirrorLimb(ctx, 40, 16, 32, 48, false, scale);
    } else {
      ctx.drawImage(source, 0, 0, width, height, 0, 0, width, height);
      // Some 64x64 skins still ship with empty added quadrants; fill them in.
      const data = ctx.getImageData(0, 0, side, side).data;
      const armBlock = 16 * scale;
      const leftArmEmpty = !blockHasPixels(data, side, 32 * scale, 48 * scale, armBlock);
      const leftLegEmpty = !blockHasPixels(data, side, 16 * scale, 48 * scale, armBlock);

      // 近乎全透明的“隐形”皮肤（只有火焰、眼睛等少量像素）没有足够的
      // 纹理判断手臂宽度，空列会被误判成纤细手臂，这里直接按经典处理
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 8) opaque++;
      }
      sparse = opaque < side * side * 0.15;

      slim = !sparse && detectSlim(ctx, scale, leftArmEmpty);

      if (leftArmEmpty && blockHasPixels(data, side, 40 * scale, 16 * scale, armBlock)) {
        mirrorLimb(ctx, 40, 16, 32, 48, slim, scale);
      }
      if (leftLegEmpty && blockHasPixels(data, side, 0, 16 * scale, armBlock)) {
        mirrorLimb(ctx, 0, 16, 16, 48, false, scale);
      }
    }

    return {
      canvas: out.canvas,
      width: side,
      height: side,
      legacy: legacy,
      slim: slim,
      sparse: sparse,
      holes: countHoles(ctx, side, scale) > 4 * scale * scale
    };
  }

  function createDefaultSkin() {
    const out = createCanvas(64, 64);
    const ctx = out.ctx;

    const skin = '#f2cda6';
    const hair = '#2b2730';
    const hairLit = '#3d3743';
    const hoodie = '#37b9a2';
    const hoodieShade = '#2c9b87';
    const pants = '#323a4b';
    const shoe = '#eae7df';
    const shoeSole = '#c9c4ba';
    const eye = '#26384a';
    const white = '#f7f3ec';
    const mouth = '#c07a70';

    // Head
    ctx.fillStyle = skin;
    ctx.fillRect(0, 0, 32, 16);

    ctx.fillStyle = hair;
    ctx.fillRect(8, 0, 8, 8);
    ctx.fillRect(0, 8, 8, 8);
    ctx.fillRect(16, 8, 8, 8);
    ctx.fillRect(24, 8, 8, 8);

    ctx.fillStyle = hairLit;
    ctx.fillRect(9, 1, 3, 2);
    ctx.fillRect(13, 2, 2, 1);

    ctx.fillStyle = skin;
    ctx.fillRect(8, 8, 8, 8);

    ctx.fillStyle = hair;
    ctx.fillRect(8, 8, 8, 2);
    ctx.fillRect(8, 8, 2, 3);
    ctx.fillRect(14, 8, 2, 3);

    ctx.fillStyle = white;
    ctx.fillRect(9, 11, 2, 2);
    ctx.fillRect(13, 11, 2, 2);

    ctx.fillStyle = eye;
    ctx.fillRect(10, 11, 1, 2);
    ctx.fillRect(13, 11, 1, 2);

    ctx.fillStyle = mouth;
    ctx.fillRect(11, 14, 2, 1);

    // Body
    ctx.fillStyle = hoodie;
    ctx.fillRect(16, 16, 24, 16);
    ctx.fillStyle = hoodieShade;
    ctx.fillRect(20, 20, 8, 1);
    ctx.fillRect(23, 22, 1, 9);
    ctx.fillRect(20, 30, 8, 2);

    // Arms (right block at 40,16 / left block at 32,48)
    ctx.fillStyle = hoodie;
    ctx.fillRect(40, 16, 16, 16);
    ctx.fillRect(32, 48, 16, 16);

    ctx.fillStyle = hoodieShade;
    ctx.fillRect(40, 28, 16, 1);
    ctx.fillRect(32, 60, 16, 1);

    ctx.fillStyle = skin;
    ctx.fillRect(40, 29, 16, 3);
    ctx.fillRect(32, 61, 16, 3);

    // 手掌：手臂底面是独立的 4×4 纹理区域
    ctx.fillRect(48, 16, 4, 4);
    ctx.fillRect(40, 48, 4, 4);

    // Legs (right block at 0,16 / left block at 16,48)
    ctx.fillStyle = pants;
    ctx.fillRect(0, 16, 16, 16);
    ctx.fillRect(16, 48, 16, 16);

    ctx.fillStyle = shoe;
    ctx.fillRect(0, 29, 16, 3);
    ctx.fillRect(16, 61, 16, 3);

    ctx.fillStyle = shoeSole;
    ctx.fillRect(0, 31, 16, 1);
    ctx.fillRect(16, 63, 16, 1);

    // 鞋底：腿底面是独立的 4×4 纹理区域
    ctx.fillRect(8, 16, 4, 4);
    ctx.fillRect(24, 48, 4, 4);

    return out.canvas;
  }

  global.Skin = {
    normalize: normalize,
    createDefaultSkin: createDefaultSkin
  };
})(window);
