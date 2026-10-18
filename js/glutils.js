(function (global) {
  'use strict';

  // ---------- column-major 4x4 matrix helpers ----------

  function identity() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  function multiply(a, b) {
    const out = new Array(16);
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4];
      const b1 = b[c * 4 + 1];
      const b2 = b[c * 4 + 2];
      const b3 = b[c * 4 + 3];
      out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  }

  function chain() {
    let out = arguments[0];
    for (let i = 1; i < arguments.length; i++) {
      out = multiply(out, arguments[i]);
    }
    return out;
  }

  function translation(x, y, z) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  }

  function scaling(x, y, z) {
    return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
  }

  function rotationX(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  }

  function rotationY(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  }

  function rotationZ(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ];
  }

  function lookAt(eye, center, up) {
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len;
    zy /= len;
    zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len;
    xy /= len;
    xz /= len;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return [
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ];
  }

  // Inverse-transpose of the upper-left 3x3 block, for correcting normals.
  function normalMat3(m) {
    const m0 = m[0], m1 = m[1], m2 = m[2];
    const m4 = m[4], m5 = m[5], m6 = m[6];
    const m8 = m[8], m9 = m[9], m10 = m[10];

    const c00 = m5 * m10 - m9 * m6;
    const c01 = -(m1 * m10 - m9 * m2);
    const c02 = m1 * m6 - m5 * m2;
    const c10 = -(m4 * m10 - m8 * m6);
    const c11 = m0 * m10 - m8 * m2;
    const c12 = -(m0 * m6 - m4 * m2);
    const c20 = m4 * m9 - m8 * m5;
    const c21 = -(m0 * m9 - m8 * m1);
    const c22 = m0 * m5 - m4 * m1;

    let det = m0 * c00 + m4 * c01 + m8 * c02;
    if (Math.abs(det) < 1e-9) {
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }
    const inv = 1 / det;
    return [
      c00 * inv, c10 * inv, c20 * inv,
      c01 * inv, c11 * inv, c21 * inv,
      c02 * inv, c12 * inv, c22 * inv
    ];
  }

  // ---------- WebGL helpers ----------

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compile failed: ' + log);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const program = gl.createProgram();
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('Program link failed: ' + log);
    }
    return program;
  }

  function createTexture(gl, source) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  global.GLUtil = {
    M4: {
      identity: identity,
      multiply: multiply,
      chain: chain,
      translation: translation,
      scaling: scaling,
      rotationX: rotationX,
      rotationY: rotationY,
      rotationZ: rotationZ,
      perspective: perspective,
      lookAt: lookAt,
      normalMat3: normalMat3
    },
    createProgram: createProgram,
    createTexture: createTexture
  };
})(window);
