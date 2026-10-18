(function (global) {
  'use strict';

  // 默认背景音乐：《朋友的酒》（1=A，4/4，120 BPM）的副歌 + 主歌，32 秒循环。
  // 全部用 Web Audio 振荡器实时合成，不打包任何音频文件；用户也可以导入自己的音乐。

  const BPM = 120;
  const BEAT = 60 / BPM;
  const STEP = BEAT / 4; // 十六分音符
  const STEPS_PER_BAR = 16;

  // 和弦：低音根音 / 五度 / 铺底三和弦 / 琶音音型
  const CHORDS = {
    'F#m': { root: 42, fifth: 49, pad: [54, 57, 61], arp: [54, 57, 61, 66] },
    'A': { root: 45, fifth: 52, pad: [57, 61, 64], arp: [57, 61, 64, 69] },
    'D': { root: 38, fifth: 45, pad: [50, 54, 57], arp: [50, 54, 57, 62] },
    'E': { root: 40, fifth: 47, pad: [52, 56, 59], arp: [52, 56, 59, 64] }
  };

  // 每小节 16 个十六分步；lead 记谱为 [起始步, MIDI 音高, 持续步数]
  // 简谱对照（1=A）：6̣=F#4 1=A4 2=B4 3=C#5 5=E5 6=F#5 1̇=A5
  const CHORUS_BARS = [
    // 快把酒满上 干了这杯 大声歌唱
    { chord: 'F#m', lead: [[0, 73, 4], [4, 78, 4], [8, 78, 2], [10, 81, 2], [12, 78, 2], [14, 76, 2]] },
    { chord: 'A', lead: [[0, 73, 2], [2, 73, 2], [4, 73, 2], [6, 71, 2], [8, 73, 2], [10, 76, 2], [12, 71, 2], [14, 69, 2]] },
    // 好朋友 好朋友 今宵多欢畅
    { chord: 'D', lead: [[0, 71, 4], [4, 71, 2], [6, 69, 2], [8, 71, 4], [12, 71, 2], [14, 69, 2]] },
    { chord: 'E', lead: [[0, 71, 2], [2, 73, 2], [4, 73, 2], [6, 71, 2], [8, 73, 8]] },
    // 理想改变了 我们的模样 也让我懂得了要珍惜朋友的肩膀
    { chord: 'F#m', lead: [[0, 73, 4], [4, 78, 4], [8, 78, 2], [10, 81, 2], [12, 78, 2], [14, 76, 2]] },
    { chord: 'A', lead: [[0, 73, 2], [2, 73, 2], [4, 73, 2], [6, 71, 2], [8, 73, 2], [10, 76, 2], [12, 71, 2], [14, 69, 2]] },
    { chord: 'D', lead: [[0, 71, 4], [4, 71, 2], [6, 69, 2], [8, 71, 4], [12, 71, 2], [14, 73, 2]] },
    { chord: 'F#m', lead: [[0, 71, 2], [2, 69, 2], [4, 66, 2], [6, 64, 2], [8, 66, 8]] }
  ];

  const VERSE_BARS = [
    // 昨日一去不复回 哦耶
    { chord: 'F#m', lead: [[0, 66, 8], [8, 73, 8]] },
    { chord: 'F#m', lead: [[0, 66, 4], [4, 69, 4], [8, 66, 4], [12, 64, 4]] },
    { chord: 'F#m', lead: [[0, 61, 16]] },
    { chord: 'A', lead: [[4, 73, 4], [8, 71, 4], [12, 69, 4]] },
    // 开心比什么都贵
    { chord: 'E', lead: [[0, 64, 8], [8, 59, 8]] },
    { chord: 'E', lead: [[0, 64, 4], [4, 56, 4], [8, 66, 2], [10, 64, 2], [12, 64, 2], [14, 66, 2]] },
    { chord: 'F#m', lead: [[0, 66, 16]] },
    { chord: 'F#m', lead: [] }
  ];

  const BARS = CHORUS_BARS.concat(VERSE_BARS);

  let ctx = null;
  let master = null;
  let reverb = null;
  let noiseBuffer = null;
  let timer = 0;
  let stepIndex = 0;
  let nextTime = 0;
  let playing = false;
  let source = 'synth';
  let audioEl = null;
  let fileUrl = null;
  let fileName = '';

  function freq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function impulse(seconds, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtor = global.AudioContext || global.webkitAudioContext;
    if (!AudioCtor) return null;

    ctx = new AudioCtor();

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.18;
    compressor.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(compressor);

    reverb = ctx.createConvolver();
    reverb.buffer = impulse(1.1, 3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    reverb.connect(wet);
    wet.connect(master);

    const length = Math.floor(ctx.sampleRate * 0.3);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) noise[i] = Math.random() * 2 - 1;

    return ctx;
  }

  function send(node, amount) {
    if (!reverb || !amount) return;
    const gain = ctx.createGain();
    gain.gain.value = amount;
    node.connect(gain);
    gain.connect(reverb);
  }

  // 主旋律：两个微失谐的三角波，副歌更亮
  function lead(time, midi, duration, bright) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = bright ? 4600 : 2800;

    const gain = ctx.createGain();
    const level = bright ? 0.15 : 0.125;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.02);
    gain.gain.setValueAtTime(level, time + Math.max(0.04, duration - 0.12));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    filter.connect(gain);
    gain.connect(master);
    send(gain, 0.16);

    [-5, 6].forEach(function (detune) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq(midi);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + duration + 0.05);
    });
  }

  // 铺底和弦
  function pad(time, chord, duration, bright) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = bright ? 1600 : 1100;

    const gain = ctx.createGain();
    const level = bright ? 0.045 : 0.035;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.14);
    gain.gain.setValueAtTime(level, time + duration - 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    filter.connect(gain);
    gain.connect(master);
    send(gain, 0.5);

    chord.pad.forEach(function (midi, index) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq(midi);
      osc.detune.value = index % 2 ? 6 : -6;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + duration + 0.05);
    });
  }

  function bass(time, midi, duration) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.2, time + 0.02);
    gain.gain.setValueAtTime(0.2, time + duration * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq(midi);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(time);
    osc.stop(time + duration + 0.03);
  }

  function arp(time, midi, accent) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;

    const gain = ctx.createGain();
    const level = accent ? 0.05 : 0.035;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq(midi + 12);
    osc.connect(filter);

    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = accent ? -0.4 : 0.4;
      filter.connect(pan);
      pan.connect(gain);
    } else {
      filter.connect(gain);
    }
    gain.connect(master);
    send(gain, 0.28);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  function kick(time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.13);
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
    osc.connect(gain);
    gain.connect(master);
    osc.start(time);
    osc.stop(time + 0.24);
  }

  function snare(time, level) {
    const volume = level == null ? 0.22 : level;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    send(gain, 0.2);

    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(220, time);
    bodyGain.gain.setValueAtTime(0.1, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    body.connect(bodyGain);
    bodyGain.connect(master);

    src.start(time);
    src.stop(time + 0.18);
    body.start(time);
    body.stop(time + 0.1);
  }

  function hat(time, level) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(time);
    src.stop(time + 0.05);
  }

  function scheduleStep(index, time) {
    const barIndex = Math.floor(index / STEPS_PER_BAR) % BARS.length;
    const local = index % STEPS_PER_BAR;
    const bar = BARS[barIndex];
    const chord = CHORDS[bar.chord];
    const bright = barIndex < CHORUS_BARS.length;

    for (let i = 0; i < bar.lead.length; i++) {
      const note = bar.lead[i];
      if (note[0] === local) {
        lead(time, note[1], Math.max(0.12, note[2] * STEP * 0.96), bright);
      }
    }

    if (local === 0) pad(time, chord, 4 * BEAT, bright);
    if (local === 0 || local === 8) bass(time, chord.root, 0.5);
    if (local === 12) bass(time, chord.fifth, 0.28);

    if (local === 0 || local === 8) kick(time);
    if (local === 4 || local === 12) snare(time);
    if (local % 2 === 0) hat(time, local % 4 === 0 ? 0.05 : 0.028);

    // 段落最后一拍加花，让副歌 / 主歌切换更自然
    const lastBar = (barIndex + 1) % BARS.length === 0 || barIndex === CHORUS_BARS.length - 1;
    if (lastBar && local >= 13) snare(time, 0.1 + (local - 13) * 0.04);

    if (bright && local % 2 === 0) {
      arp(time, chord.arp[(local / 2) % chord.arp.length], local % 4 === 0);
    }
  }

  function pump() {
    while (nextTime < ctx.currentTime + 0.15) {
      scheduleStep(stepIndex, nextTime);
      nextTime += STEP;
      stepIndex = (stepIndex + 1) % (BARS.length * STEPS_PER_BAR);
    }
  }

  function startSynth() {
    if (!ensureContext()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0.55, ctx.currentTime);

    stepIndex = 0;
    nextTime = ctx.currentTime + 0.06;
    clearInterval(timer);
    timer = setInterval(pump, 25);
    pump();

    document.dispatchEvent(new CustomEvent('skinlab:musicstart'));
    return true;
  }

  function stopSynth() {
    clearInterval(timer);
    timer = 0;
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    }
  }

  function startFile() {
    if (!audioEl) return false;
    audioEl.currentTime = 0;
    const promise = audioEl.play();
    if (promise && promise.catch) promise.catch(function () {});
    document.dispatchEvent(new CustomEvent('skinlab:musicstart'));
    return true;
  }

  function notify() {
    if (typeof api.onState === 'function') api.onState();
  }

  function play() {
    if (playing) return true;
    playing = source === 'file' ? startFile() : startSynth();
    notify();
    return playing;
  }

  function stop() {
    if (!playing) return;
    playing = false;
    stopSynth();
    if (audioEl) audioEl.pause();
    notify();
  }

  function setFile(file) {
    if (!file) return;
    stop();

    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = URL.createObjectURL(file);
    audioEl = new Audio(fileUrl);
    audioEl.loop = true;
    audioEl.volume = 0.9;
    source = 'file';
    fileName = String(file.name || '自定义音乐').replace(/\.[^.]+$/, '');

    play();
  }

  function clearFile() {
    stop();
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
      audioEl = null;
    }
    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
      fileUrl = null;
    }
    source = 'synth';
    fileName = '';
    play();
  }

  const api = {
    onState: null,
    isPlaying: function () {
      return playing;
    },
    source: function () {
      return source;
    },
    label: function () {
      return source === 'file' ? fileName : '默认旋律';
    },
    toggle: function () {
      return playing ? (stop(), false) : play();
    },
    play: play,
    stop: stop,
    setFile: setFile,
    clearFile: clearFile
  };

  global.SkinAudio = api;
})(window);
