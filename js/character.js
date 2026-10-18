(function (global) {
  'use strict';

  const M4 = global.GLUtil.M4;

  // Texture layout of the modern 64x64 skin (values in 64px skin space).
  const PART_DEFS = {
    head:     { tw: 8, th: 8,  td: 8, u: 0,  v: 0,  ou: 32, ov: 0  },
    body:     { tw: 8, th: 12, td: 4, u: 16, v: 16, ou: 16, ov: 32 },
    rightArm: { tw: 4, th: 12, td: 4, u: 40, v: 16, ou: 40, ov: 32 },
    leftArm:  { tw: 4, th: 12, td: 4, u: 32, v: 48, ou: 48, ov: 48 },
    rightLeg: { tw: 4, th: 12, td: 4, u: 0,  v: 16, ou: 0,  ov: 32 },
    leftLeg:  { tw: 4, th: 12, td: 4, u: 16, v: 48, ou: 0,  ov: 48 }
  };
  const PART_ORDER = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];

  const DOLL_LIMB = 0.68;
  const DOLL_HEAD = 1.8;

  // 环形站位：中间是放大的主模型，其余小模型整圈绕行；数量多时分成内外两圈
  const CENTER_SCALE = 1.3;
  const RING_SCALE = 0.54;
  const RING_SPACING = 8;
  const RING_INNER = 21;
  const RING_OUTER = 33;
  const RING_SPLIT = 8;
  // 默认镜头方位：让环上两个模型之间正对镜头，避免有模型顶在主模型正前方
  const RING_PHASE = 0.55;

  const VERTEX_SHADER = [
    'attribute vec3 aPosition;',
    'attribute vec3 aNormal;',
    'attribute vec2 aUv;',
    'uniform mat4 uProjection;',
    'uniform mat4 uView;',
    'uniform mat4 uModel;',
    'uniform mat3 uNormalMatrix;',
    'varying vec3 vNormal;',
    'varying vec2 vUv;',
    'void main() {',
    '  vNormal = normalize(uNormalMatrix * aNormal);',
    '  vUv = aUv;',
    '  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);',
    '}'
  ].join('\n');

  const FRAGMENT_SHADER = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'varying vec2 vUv;',
    'uniform sampler2D uTexture;',
    'uniform vec3 uLightDir;',
    'uniform float uUnlit;',
    'uniform float uAlpha;',
    'uniform vec3 uFillColor;',
    'uniform float uFillOn;',
    'void main() {',
    '  vec3 n = normalize(vNormal);',
    '  float diff = max(dot(n, uLightDir), 0.0);',
    '  float fill = max(dot(n, normalize(vec3(-0.55, 0.15, -0.7))), 0.0);',
    '  float lum = mix(0.72 + 0.34 * diff + 0.16 * fill, 1.0, uUnlit);',
    '  vec4 tex = texture2D(uTexture, vUv);',
    '  if (tex.a < 0.04) {',
    '    if (uFillOn < 0.5) discard;',
    '    gl_FragColor = vec4(uFillColor * lum, uAlpha);',
    '    return;',
    '  }',
    '  gl_FragColor = vec4(tex.rgb * lum, tex.a * uAlpha);',
    '}'
  ].join('\n');

  /**
   * Build a textured box.
   * gw/gh/gd are geometry dimensions (64px skin space), tw/th/td are the
   * texture-layout dimensions in actual texture pixels, u0/v0 is the origin.
   */
  function buildBoxData(gw, gh, gd, tw, th, td, u0, v0, texW, texH) {
    const hw = gw / 2;
    const hh = gh / 2;
    const hd = gd / 2;

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    const inset = 0.5;
    function rect(x1, y1, x2, y2) {
      return {
        tl: [(x1 + inset) / texW, (y1 + inset) / texH],
        tr: [(x2 - inset) / texW, (y1 + inset) / texH],
        bl: [(x1 + inset) / texW, (y2 - inset) / texH],
        br: [(x2 - inset) / texW, (y2 - inset) / texH]
      };
    }

    function face(verts, uv, normal) {
      const base = positions.length / 3;
      for (let i = 0; i < 4; i++) {
        positions.push(verts[i][0], verts[i][1], verts[i][2]);
        normals.push(normal[0], normal[1], normal[2]);
        uvs.push(uv[i][0], uv[i][1]);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    let r;

    // +X (character's left side)
    r = rect(u0 + td + tw, v0 + td, u0 + td + tw + td, v0 + td + th);
    face(
      [[hw, hh, hd], [hw, hh, -hd], [hw, -hh, -hd], [hw, -hh, hd]],
      [r.tl, r.tr, r.br, r.bl],
      [1, 0, 0]
    );

    // -X (character's right side)
    r = rect(u0, v0 + td, u0 + td, v0 + td + th);
    face(
      [[-hw, hh, -hd], [-hw, hh, hd], [-hw, -hh, hd], [-hw, -hh, -hd]],
      [r.tl, r.tr, r.br, r.bl],
      [-1, 0, 0]
    );

    // +Y (top)
    r = rect(u0 + td, v0, u0 + td + tw, v0 + td);
    face(
      [[-hw, hh, -hd], [hw, hh, -hd], [hw, hh, hd], [-hw, hh, hd]],
      [r.tl, r.tr, r.br, r.bl],
      [0, 1, 0]
    );

    // -Y (bottom)
    r = rect(u0 + td + tw, v0, u0 + td + tw * 2, v0 + td);
    face(
      [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]],
      [r.tl, r.tr, r.br, r.bl],
      [0, -1, 0]
    );

    // +Z (front)
    r = rect(u0 + td, v0 + td, u0 + td + tw, v0 + td + th);
    face(
      [[-hw, hh, hd], [hw, hh, hd], [hw, -hh, hd], [-hw, -hh, hd]],
      [r.tl, r.tr, r.br, r.bl],
      [0, 0, 1]
    );

    // -Z (back)
    r = rect(u0 + tw + td * 2, v0 + td, u0 + tw * 2 + td * 2, v0 + td + th);
    face(
      [[hw, hh, -hd], [-hw, hh, -hd], [-hw, -hh, -hd], [hw, -hh, -hd]],
      [r.tl, r.tr, r.br, r.bl],
      [0, 0, -1]
    );

    return { positions: positions, normals: normals, uvs: uvs, indices: indices };
  }

  function buildShadowData() {
    return {
      positions: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      indices: [0, 1, 2, 0, 2, 3]
    };
  }

  function createShadowTexture(gl) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
    grad.addColorStop(0.42, 'rgba(0, 0, 0, 0.4)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return GLUtil.createTexture(gl, canvas);
  }

  class Renderer {
    constructor(canvas, options) {
      const opts = options || {};
      const gl = canvas.getContext('webgl', {
        antialias: opts.antialias !== false,
        alpha: true,
        premultipliedAlpha: false,
        depth: true
      });
      if (!gl) {
        throw new Error('WebGL is not available');
      }

      this.gl = gl;
      this.canvas = canvas;
      this.width = canvas.width;
      this.height = canvas.height;

      this.program = GLUtil.createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
      this.aPosition = gl.getAttribLocation(this.program, 'aPosition');
      this.aNormal = gl.getAttribLocation(this.program, 'aNormal');
      this.aUv = gl.getAttribLocation(this.program, 'aUv');
      this.uProjection = gl.getUniformLocation(this.program, 'uProjection');
      this.uView = gl.getUniformLocation(this.program, 'uView');
      this.uModel = gl.getUniformLocation(this.program, 'uModel');
      this.uNormalMatrix = gl.getUniformLocation(this.program, 'uNormalMatrix');
      this.uTexture = gl.getUniformLocation(this.program, 'uTexture');
      this.uLightDir = gl.getUniformLocation(this.program, 'uLightDir');
      this.uUnlit = gl.getUniformLocation(this.program, 'uUnlit');
      this.uAlpha = gl.getUniformLocation(this.program, 'uAlpha');
      this.uFillColor = gl.getUniformLocation(this.program, 'uFillColor');
      this.uFillOn = gl.getUniformLocation(this.program, 'uFillOn');

      gl.useProgram(this.program);
      gl.uniform1i(this.uTexture, 0);

      const light = [0.44, 0.78, 0.54];
      const len = Math.hypot(light[0], light[1], light[2]);
      gl.uniform3fv(this.uLightDir, [light[0] / len, light[1] / len, light[2] / len]);

      this.shadowTexture = createShadowTexture(gl);
      this.shadowMesh = this.uploadMesh(buildShadowData());
    }

    setViewport(width, height) {
      this.width = width;
      this.height = height;
    }

    uploadMesh(data) {
      const gl = this.gl;
      const mesh = { count: data.indices.length };

      mesh.position = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.positions), gl.STATIC_DRAW);

      mesh.normal = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.normals), gl.STATIC_DRAW);

      mesh.uv = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.uvs), gl.STATIC_DRAW);

      mesh.index = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), gl.STATIC_DRAW);

      return mesh;
    }

    deleteMesh(mesh) {
      const gl = this.gl;
      gl.deleteBuffer(mesh.position);
      gl.deleteBuffer(mesh.normal);
      gl.deleteBuffer(mesh.uv);
      gl.deleteBuffer(mesh.index);
    }

    buildPart(gw, gh, gd, tw, th, td, u0, v0, texW, texH) {
      const scale = texW / 64;
      const data = buildBoxData(
        gw, gh, gd,
        tw * scale, th * scale, td * scale,
        u0 * scale, v0 * scale,
        texW, texH
      );
      return this.uploadMesh(data);
    }

    buildMeshSet(texW, texH, slim) {
      const meshes = { base: {}, overlay: {} };

      for (const name of PART_ORDER) {
        const def = PART_DEFS[name];
        const arm = name === 'rightArm' || name === 'leftArm';
        const tw = arm && slim ? 3 : def.tw;
        let gw = tw;
        let gh = 12;
        let gd = 4;

        if (name === 'head') {
          gw = 8; gh = 8; gd = 8;
        } else if (name === 'body') {
          gw = 8; gh = 12; gd = 4;
        }

        meshes.base[name] = this.buildPart(
          gw, gh, gd, tw, def.th, def.td, def.u, def.v, texW, texH
        );

        // 帽子层每边外扩 0.5px（尺寸 +1），外套/袖子/裤腿层每边外扩 0.25px（尺寸 +0.5）
        const inflate = name === 'head' ? 1 : 0.5;
        meshes.overlay[name] = this.buildPart(
          gw + inflate, gh + inflate, gd + inflate,
          tw, def.th, def.td,
          def.ou, def.ov, texW, texH
        );
      }

      return meshes;
    }

    /** Upload a skin texture and both arm-width mesh sets. */
    createActor(skinCanvas) {
      const gl = this.gl;
      const texW = skinCanvas.width;
      const texH = skinCanvas.height;
      return {
        texture: GLUtil.createTexture(gl, skinCanvas),
        texW: texW,
        texH: texH,
        classic: this.buildMeshSet(texW, texH, false),
        slim: this.buildMeshSet(texW, texH, true)
      };
    }

    deleteActor(actor) {
      const gl = this.gl;
      gl.deleteTexture(actor.texture);
      for (const key of ['classic', 'slim']) {
        const set = actor[key];
        for (const name of PART_ORDER) {
          this.deleteMesh(set.base[name]);
          this.deleteMesh(set.overlay[name]);
        }
      }
    }

    drawMesh(mesh, model, unlit, alpha, fill) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
      gl.enableVertexAttribArray(this.aPosition);
      gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
      gl.enableVertexAttribArray(this.aNormal);
      gl.vertexAttribPointer(this.aNormal, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
      gl.enableVertexAttribArray(this.aUv);
      gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.uniformMatrix4fv(this.uModel, false, model);
      gl.uniformMatrix3fv(this.uNormalMatrix, false, M4.normalMat3(model));
      gl.uniform1f(this.uUnlit, unlit);
      gl.uniform1f(this.uAlpha, alpha);
      gl.uniform1f(this.uFillOn, fill ? 1 : 0);
      if (fill) gl.uniform3fv(this.uFillColor, fill);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }

    /**
     * scene = {
     *   actors: [{ actor, pose, model, slim }],
     *   shadows: [{ matrix, alpha }],
     *   overlay: boolean
     * }
     */
    renderScene(scene, projection, view) {
      const gl = this.gl;
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.uProjection, false, projection);
      gl.uniformMatrix4fv(this.uView, false, view);

      // Contact shadows
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
      for (let i = 0; i < scene.shadows.length; i++) {
        this.drawMesh(this.shadowMesh, scene.shadows[i].matrix, 1, scene.shadows[i].alpha);
      }
      gl.depthMask(true);

      // Opaque skin
      gl.disable(gl.BLEND);
      for (let i = 0; i < scene.actors.length; i++) {
        const item = scene.actors[i];
        const set = item.slim ? item.actor.slim : item.actor.classic;
        gl.bindTexture(gl.TEXTURE_2D, item.actor.texture);
        for (const name of PART_ORDER) {
          this.drawMesh(
            set.base[name],
            M4.multiply(item.model, item.pose.meshes[name]),
            0,
            1,
            item.fill || null
          );
        }
      }

      // Overlay layer
      if (scene.overlay) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        for (let i = 0; i < scene.actors.length; i++) {
          const item = scene.actors[i];
          const set = item.slim ? item.actor.slim : item.actor.classic;
          gl.bindTexture(gl.TEXTURE_2D, item.actor.texture);
          for (const name of PART_ORDER) {
            this.drawMesh(
              set.overlay[name],
              M4.multiply(item.model, item.pose.meshes[name]),
              0,
              1,
              null
            );
          }
        }
        gl.disable(gl.BLEND);
      }

      gl.depthMask(true);
    }
  }

  function computePose(options) {
    const dollT = options.dollT;
    const sitT = options.sitT;

    const L = 1 + (DOLL_LIMB - 1) * dollT;
    const H = 1 + (DOLL_HEAD - 1) * dollT;

    const legHeight = 12 * L;
    const hipsY = legHeight + (2 * L - legHeight) * sitT;
    const neckY = hipsY + 12 * L;

    const armWidth = (options.slim ? 3 : 4) * L;
    const armX = 4 * L + armWidth / 2;
    // 手臂旋转轴在原版模型里位于肩关节 x=±5，而不是手臂中心
    const armPivotX = 5 * L;
    const armOffsetX = armX - armPivotX;
    const shoulderY = neckY - 2 * L;

    const legRot = (-Math.PI / 2) * sitT;
    const armSwing = -0.3 * sitT;
    const armSpread = 0.09 * dollT * (1 - sitT);
    const headTilt = -0.045 * dollT * (1 - sitT);

    const squash = options.squash;
    const sy = squash;
    const sxz = 1 / Math.sqrt(sy);

    const root = M4.scaling(sxz, sy, sxz);

    const meshes = {
      head: M4.chain(
        root,
        M4.translation(0, neckY, 0),
        M4.rotationZ(headTilt),
        M4.translation(0, 4 * H, 0),
        M4.scaling(H, H, H)
      ),
      body: M4.chain(
        root,
        M4.translation(0, hipsY + 6 * L, 0),
        M4.scaling(L, L, L)
      ),
      rightArm: M4.chain(
        root,
        M4.translation(-armPivotX, shoulderY, 0),
        M4.rotationX(armSwing),
        M4.rotationZ(-armSpread),
        M4.translation(-armOffsetX, -4 * L, 0),
        M4.scaling(L, L, L)
      ),
      leftArm: M4.chain(
        root,
        M4.translation(armPivotX, shoulderY, 0),
        M4.rotationX(armSwing),
        M4.rotationZ(armSpread),
        M4.translation(armOffsetX, -4 * L, 0),
        M4.scaling(L, L, L)
      ),
      rightLeg: M4.chain(
        root,
        M4.translation(-1.9 * L, hipsY, -0.1 * L),
        M4.rotationX(legRot),
        M4.translation(0, -6 * L, 0),
        M4.scaling(L, L, L)
      ),
      leftLeg: M4.chain(
        root,
        M4.translation(1.9 * L, hipsY, -0.1 * L),
        M4.rotationX(legRot),
        M4.translation(0, -6 * L, 0),
        M4.scaling(L, L, L)
      )
    };

    return {
      meshes: meshes,
      totalHeight: neckY + 8 * H,
      neckY: neckY,
      hipsY: hipsY,
      limbScale: L,
      headScale: H
    };
  }

  /** 小模型的环形排布方案：数量少时一圈，多时内外两圈。 */
  function ringPlan(count) {
    const total = Math.max(0, count - 1);
    if (total < RING_SPLIT) {
      return [{
        count: total,
        radius: Math.max(RING_INNER, total * RING_SPACING / (Math.PI * 2))
      }];
    }

    // 按半径比例分配：内圈周长短，放更少的模型，外圈多放一些，
    // 让两圈的疏密程度接近
    const inner = Math.max(1, Math.round(total * RING_INNER / (RING_INNER + RING_OUTER)));
    const outer = total - inner;
    const innerRadius = Math.max(RING_INNER, inner * RING_SPACING / (Math.PI * 2));
    const outerRadius = Math.max(
      RING_OUTER,
      innerRadius + 9,
      outer * RING_SPACING / (Math.PI * 2)
    );

    return [
      { count: inner, radius: innerRadius },
      { count: outer, radius: outerRadius }
    ];
  }

  /**
   * 完整一圈（或内外两圈）的站位：选中（放大）的模型在中间，
   * 其余模型均匀绕圈，所有模型都朝向 +Z（镜头方向），不做朝向旋转。
   */
  function computeLayout(count, selectedIndex, order) {
    const out = new Array(count);
    const hasSelected = selectedIndex >= 0 && selectedIndex < count;
    const others = [];

    // order 是环上的实际次序；切换模型时由调用方维护，用来做整圈旋转
    if (order && order.length) {
      for (let i = 0; i < order.length; i++) {
        const index = order[i];
        if (index >= 0 && index < count && index !== selectedIndex && others.indexOf(index) < 0) {
          others.push(index);
        }
      }
    }
    for (let i = 0; i < count; i++) {
      if ((!hasSelected || i !== selectedIndex) && others.indexOf(i) < 0) {
        others.push(i);
      }
    }

    if (hasSelected) {
      out[selectedIndex] = { x: 0, z: 0, scale: CENTER_SCALE };
    } else if (count > 0) {
      out[0] = { x: 0, z: 0, scale: CENTER_SCALE };
      const pos = others.indexOf(0);
      if (pos >= 0) others.splice(pos, 1);
    }

    const rings = ringPlan(count);
    let cursor = 0;

    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      const step = Math.PI * 2 / Math.max(1, ring.count);
      // 半格偏移让镜头正对两个模型之间的空档；外圈再错开半格，
      // 让内外两圈的模型交错排布，避免前后重叠
      const offset = RING_PHASE + step * (r === 0 ? 0.5 : 1);

      for (let k = 0; k < ring.count && cursor < others.length; k++, cursor++) {
        const angle = offset + step * k;
        out[others[cursor]] = {
          x: Math.sin(angle) * ring.radius,
          z: Math.cos(angle) * ring.radius,
          scale: RING_SCALE
        };
      }
    }

    return out;
  }

  /** 最外圈半径，用来算相机距离。 */
  function layoutRadius(count) {
    const rings = ringPlan(count);
    return rings[rings.length - 1].radius;
  }

  /** 把整组模型框进画面的相机距离。 */
  function framingDistance(totalHeight, count, aspect) {
    let dist = totalHeight * CENTER_SCALE * 2.5;
    if (count > 1) {
      const halfWidth = layoutRadius(count) + 4;
      const tanV = Math.tan(0.58 / 2);
      const ratio = Math.max(0.5, Math.min(2.4, aspect));
      dist = Math.max(dist, halfWidth / (tanV * ratio) * 1.22);
    }
    return Math.max(48, Math.min(420, dist));
  }

  global.Skin3D = {
    Renderer: Renderer,
    computePose: computePose,
    computeLayout: computeLayout,
    framingDistance: framingDistance,
    CENTER_SCALE: CENTER_SCALE,
    FRONT_ANGLE: RING_PHASE,
    RING_SCALE: RING_SCALE
  };
})(window);
