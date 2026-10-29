/**
 * 音效模块：用 Web Audio 实时合成，不依赖任何音频文件
 * （这样单文件 HTML 依然可以离线双击运行，也不涉及版权素材）
 *
 * 对外接口：
 *   playSound(kind)            播放音效，kind: move|capture|check|win|lose|draw|ui|illegal
 *   unlockSound()              用户首次交互时调用，解锁 AudioContext
 *   setSoundVolume(0~1)        设置音量
 *   setSoundMuted(bool)        静音开关
 *   isSoundMuted() / getSoundVolume()
 *   loadSoundSettings() / saveSoundSettings()  读写 localStorage
 */

const SND_LS_KEY = 'xiangqi.sound.v1';
const SND_DEFAULTS = { volume: 0.7, muted: false };

let sndCtx = null;
let sndMaster = null;
let sndSettings = { ...SND_DEFAULTS };

/** 读取本地设置 */
export function loadSoundSettings() {
  try {
    const raw = localStorage.getItem(SND_LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      sndSettings = {
        volume: typeof o.volume === 'number' ? sndClamp01(o.volume) : SND_DEFAULTS.volume,
        muted: !!o.muted,
      };
    }
  } catch {
    sndSettings = { ...SND_DEFAULTS };
  }
  sndApplyGain();
  return { ...sndSettings };
}

export function saveSoundSettings() {
  try {
    localStorage.setItem(SND_LS_KEY, JSON.stringify(sndSettings));
  } catch {
    /* 存不了就算了，不影响使用 */
  }
}

function sndClamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** 懒创建 AudioContext（浏览器要求先有用户交互） */
function sndEnsureCtx() {
  if (sndCtx) return sndCtx;
  const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    sndCtx = new AC();
    sndMaster = sndCtx.createGain();
    sndMaster.gain.value = sndSettings.muted ? 0 : sndSettings.volume;
    sndMaster.connect(sndCtx.destination);
  } catch {
    sndCtx = null;
    sndMaster = null;
  }
  return sndCtx;
}

function sndApplyGain() {
  if (!sndMaster || !sndCtx) return;
  const target = sndSettings.muted ? 0 : sndSettings.volume;
  try {
    sndMaster.gain.setTargetAtTime(target, sndCtx.currentTime, 0.02);
  } catch {
    sndMaster.gain.value = target;
  }
}

export function setSoundVolume(v) {
  sndSettings.volume = sndClamp01(v);
  if (sndSettings.volume > 0) sndSettings.muted = false;
  sndApplyGain();
  saveSoundSettings();
  return { ...sndSettings };
}

export function setSoundMuted(m) {
  sndSettings.muted = !!m;
  sndApplyGain();
  saveSoundSettings();
  return { ...sndSettings };
}

export function isSoundMuted() {
  return sndSettings.muted;
}

export function getSoundVolume() {
  return sndSettings.volume;
}

/** 用户首次点击时解锁音频（移动端/Chrome 的自动播放限制） */
export function unlockSound() {
  const c = sndEnsureCtx();
  if (c && c.state === 'suspended') {
    c.resume().catch(() => {});
  }
}

// ---------- 合成基元 ----------

/** 一段带包络的振荡音 */
function sndTone(t0, { freq = 440, type = 'sine', dur = 0.12, gain = 0.3, slideTo = null }) {
  if (!sndCtx || !sndMaster) return;
  const osc = sndCtx.createOscillator();
  const g = sndCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);

  // 快起快落，像敲击
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g);
  g.connect(sndMaster);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 一段噪声（做木质敲击的"嚓"） */
function sndNoise(t0, { dur = 0.06, gain = 0.2, filterFreq = 2400, q = 1 }) {
  if (!sndCtx || !sndMaster) return;
  const len = Math.max(1, Math.floor(sndCtx.sampleRate * dur));
  const buf = sndCtx.createBuffer(1, len, sndCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // 越往后越弱，形成自然衰减
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  const src = sndCtx.createBufferSource();
  src.buffer = buf;

  const bp = sndCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = filterFreq;
  bp.Q.value = q;

  const g = sndCtx.createGain();
  g.gain.value = gain;

  src.connect(bp);
  bp.connect(g);
  g.connect(sndMaster);
  src.start(t0);
}

// ---------- 具体音效 ----------

const SND_RECIPES = {
  // 落子：木质短促的"哒"
  move(t0) {
    sndNoise(t0, { dur: 0.05, gain: 0.26, filterFreq: 2100, q: 1.2 });
    sndTone(t0, { freq: 210, type: 'triangle', dur: 0.09, gain: 0.22, slideTo: 120 });
  },
  // 吃子：更重、更低、稍长
  capture(t0) {
    sndNoise(t0, { dur: 0.1, gain: 0.34, filterFreq: 1400, q: 0.9 });
    sndTone(t0, { freq: 150, type: 'square', dur: 0.13, gain: 0.24, slideTo: 70 });
    sndTone(t0 + 0.02, { freq: 90, type: 'sine', dur: 0.2, gain: 0.2, slideTo: 55 });
  },
  // 将军：两声上行警示
  check(t0) {
    sndTone(t0, { freq: 660, type: 'square', dur: 0.09, gain: 0.18 });
    sndTone(t0 + 0.11, { freq: 880, type: 'square', dur: 0.12, gain: 0.2 });
  },
  // 胜利：上行三音
  win(t0) {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      sndTone(t0 + i * 0.11, { freq: f, type: 'triangle', dur: 0.2, gain: 0.22 });
    });
  },
  // 失败：下行三音
  lose(t0) {
    const notes = [392, 311, 233];
    notes.forEach((f, i) => {
      sndTone(t0 + i * 0.14, { freq: f, type: 'triangle', dur: 0.26, gain: 0.2 });
    });
  },
  // 和棋：中性两音
  draw(t0) {
    sndTone(t0, { freq: 440, type: 'triangle', dur: 0.18, gain: 0.18 });
    sndTone(t0 + 0.16, { freq: 440, type: 'triangle', dur: 0.18, gain: 0.16 });
  },
  // 操作反馈：很轻的一下
  ui(t0) {
    sndNoise(t0, { dur: 0.03, gain: 0.12, filterFreq: 3200, q: 1.5 });
  },
  // 非法操作
  illegal(t0) {
    sndTone(t0, { freq: 180, type: 'sawtooth', dur: 0.12, gain: 0.16, slideTo: 120 });
  },
};

/**
 * 播放音效
 * @param {'move'|'capture'|'check'|'win'|'lose'|'draw'|'ui'|'illegal'} kind
 */
export function playSound(kind) {
  if (sndSettings.muted || sndSettings.volume <= 0) return;
  const c = sndEnsureCtx();
  if (!c || c.state === 'suspended') {
    // 还没解锁就尝试恢复一次，本次可能不响，下次就正常了
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    return;
  }
  const recipe = SND_RECIPES[kind];
  if (!recipe) return;
  try {
    recipe(c.currentTime + 0.001);
  } catch {
    /* 音效失败不能影响游戏 */
  }
}
