/*
 * T-Rex Dino for PewPlay.
 * Endless runner based on the open-source T-Rex runner
 * (Copyright (c) 2014 The Chromium Authors, BSD-style licence),
 * rewritten to fill any screen, with pointer/touch controls and a saved best score.
 */
(function () {
  'use strict';

  var FPS = 60;
  var MS_PER_FRAME = 1000 / FPS;
  var DEFAULT_WIDTH = 600;
  var HEIGHT = 150;            // logical height of the play strip
  var MIN_WIDTH = 300;         // narrowest logical width (phones in portrait)
  var MAX_WIDTH = 1000;        // widest logical width (very wide windows)

  var CONFIG = {
    ACCELERATION: 0.001,
    BOTTOM_PAD: 10,
    CLEAR_TIME: 3000,
    GAMEOVER_CLEAR_TIME: 750,
    GAP_COEFFICIENT: 0.6,
    MAX_SPEED: 12,
    MOBILE_SPEED_COEFFICIENT: 1.2,
    SPEED: 6,
    INTRO_TIME: 400
  };

  var KEYS = {
    JUMP: { ArrowUp: 1, Space: 1, KeyW: 1 },
    DROP: { ArrowDown: 1, KeyS: 1 },
    RESTART: { Enter: 1, NumpadEnter: 1 }
  };

  var STORE_BEST = 'dino:best';
  var STORE_MUTED = 'dino:muted';

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, String(value));
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  function rnd(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function now() { return performance.now(); }

  // ---------------------------------------------------------------- images
  var IMG = {};
  var IMG_SRC = {
    TREX: 'assets/trex.png',
    CACTUS_SMALL: 'assets/cactus-small.png',
    CACTUS_LARGE: 'assets/cactus-large.png',
    CLOUD: 'assets/cloud.png',
    HORIZON: 'assets/horizon.png',
    RESTART: 'assets/restart.png',
    TEXT: 'assets/text.png'
  };

  // Sprites are stored at 2x: source coordinates are doubled.
  function sprite(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
    ctx.drawImage(img, sx * 2, sy * 2, sw * 2, sh * 2, dx, dy, dw, dh);
  }

  // ----------------------------------------------------------------- audio
  var Sound = {
    ctx: null,
    muted: store(STORE_MUTED) === '1',
    unlock: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
    },
    tone: function (freq, start, dur, vol, type) {
      var c = this.ctx;
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      var t = c.currentTime + start;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.005);
      g.gain.setValueAtTime(vol, t + dur - 0.01);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    play: function (name) {
      if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
      if (name === 'jump') {
        this.tone(740, 0, 0.07, 0.06);
      } else if (name === 'score') {
        this.tone(1046, 0, 0.08, 0.05);
        this.tone(1318, 0.1, 0.12, 0.05);
      } else if (name === 'hit') {
        this.tone(160, 0, 0.09, 0.08);
        this.tone(110, 0.1, 0.16, 0.08);
      }
    }
  };

  // ------------------------------------------------------------- collision
  function Box(x, y, w, h) {
    this.x = x; this.y = y; this.width = w; this.height = h;
  }

  function boxCompare(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
      a.y < b.y + b.height && a.height + a.y > b.y;
  }

  function checkForCollision(obstacle, tRex) {
    // 1px adjustments: sprites have a 1px border around them.
    var tRexBox = new Box(tRex.xPos + 1, tRex.yPos + 1, Trex.WIDTH - 2, Trex.HEIGHT - 2);
    var obstacleBox = new Box(obstacle.xPos + 1, obstacle.yPos + 1,
      obstacle.type.width * obstacle.size - 2, obstacle.type.height - 2);
    if (!boxCompare(tRexBox, obstacleBox)) return false;
    for (var t = 0; t < Trex.collisionBoxes.length; t++) {
      for (var i = 0; i < obstacle.collisionBoxes.length; i++) {
        var tb = Trex.collisionBoxes[t];
        var ob = obstacle.collisionBoxes[i];
        if (boxCompare(new Box(tb.x + tRexBox.x, tb.y + tRexBox.y, tb.width, tb.height),
          new Box(ob.x + obstacleBox.x, ob.y + obstacleBox.y, ob.width, ob.height))) {
          return true;
        }
      }
    }
    return false;
  }

  // -------------------------------------------------------------- obstacle
  var OBSTACLE_TYPES = [
    {
      img: 'CACTUS_SMALL', width: 17, height: 35, yPos: 105, multipleSpeed: 3, minGap: 120,
      collisionBoxes: [new Box(0, 7, 5, 27), new Box(4, 0, 6, 34), new Box(10, 4, 7, 14)]
    },
    {
      img: 'CACTUS_LARGE', width: 25, height: 50, yPos: 90, multipleSpeed: 6, minGap: 120,
      collisionBoxes: [new Box(0, 12, 7, 38), new Box(8, 0, 7, 49), new Box(13, 10, 10, 38)]
    }
  ];
  var MAX_OBSTACLE_LENGTH = 3;
  var MAX_GAP_COEFFICIENT = 1.5;

  function Obstacle(type, worldWidth, speed) {
    this.type = type;
    this.size = rnd(1, MAX_OBSTACLE_LENGTH);
    this.remove = false;
    this.followingCreated = false;
    this.yPos = type.yPos;
    this.collisionBoxes = type.collisionBoxes.map(function (b) {
      return new Box(b.x, b.y, b.width, b.height);
    });
    // Groups are only allowed once the game is fast enough.
    if (this.size > 1 && type.multipleSpeed > speed) this.size = 1;
    this.width = type.width * this.size;
    this.xPos = worldWidth - this.width;
    if (this.size > 1) {
      this.collisionBoxes[1].width = this.width - this.collisionBoxes[0].width -
        this.collisionBoxes[2].width;
      this.collisionBoxes[2].x = this.width - this.collisionBoxes[2].width;
    }
    var minGap = Math.round(this.width * speed + type.minGap * CONFIG.GAP_COEFFICIENT);
    this.gap = rnd(minGap, Math.round(minGap * MAX_GAP_COEFFICIENT));
  }

  Obstacle.prototype.update = function (dt, speed) {
    this.xPos -= Math.floor(speed * FPS / 1000 * dt);
    if (this.xPos + this.width <= 0) this.remove = true;
  };

  Obstacle.prototype.draw = function (ctx) {
    var t = this.type;
    var sx = (t.width * this.size) * (0.5 * (this.size - 1));
    sprite(ctx, IMG[t.img], sx, 0, t.width * this.size, t.height,
      this.xPos, this.yPos, t.width * this.size, t.height);
  };

  // ------------------------------------------------------------------ trex
  function Trex() {
    this.xPos = Trex.START_X_POS;
    this.groundYPos = HEIGHT - Trex.HEIGHT - CONFIG.BOTTOM_PAD;
    this.yPos = this.groundYPos;
    this.minJumpHeight = this.groundYPos - Trex.MIN_JUMP_HEIGHT;
    this.timer = 0;
    this.currentFrame = 0;
    this.jumping = false;
    this.jumpVelocity = 0;
    this.reachedMinHeight = false;
    this.speedDrop = false;
    this.blinkDelay = 0;
    this.animStart = now();
    this.setStatus('WAITING');
  }

  Trex.WIDTH = 44;
  Trex.HEIGHT = 47;
  Trex.DROP_VELOCITY = -5;
  Trex.GRAVITY = 0.6;
  Trex.INITIAL_JUMP_VELOCITY = -10;
  Trex.MAX_JUMP_HEIGHT = 30;
  Trex.MIN_JUMP_HEIGHT = 30;
  Trex.SPEED_DROP_COEFFICIENT = 3;
  Trex.START_X_POS = 50;
  Trex.BLINK_TIMING = 7000;
  Trex.collisionBoxes = [
    new Box(1, -1, 30, 26), new Box(32, 0, 8, 16), new Box(10, 35, 14, 8),
    new Box(1, 24, 29, 5), new Box(5, 30, 21, 4), new Box(9, 34, 15, 4)
  ];
  Trex.anim = {
    WAITING: { frames: [44, 0], ms: 1000 / 3 },
    RUNNING: { frames: [88, 132], ms: 1000 / 12 },
    CRASHED: { frames: [220], ms: 1000 / 60 },
    JUMPING: { frames: [0], ms: 1000 / 60 }
  };

  Trex.prototype.setStatus = function (status) {
    this.status = status;
    this.currentFrame = 0;
    this.timer = 0;
    if (status === 'WAITING') {
      this.animStart = now();
      this.blinkDelay = Math.ceil(Math.random() * Trex.BLINK_TIMING);
    }
  };

  Trex.prototype.update = function (dt) {
    this.timer += dt;
    var a = Trex.anim[this.status];
    if (this.status === 'WAITING') {
      // Blink at random intervals.
      if (now() - this.animStart >= this.blinkDelay) {
        if (this.timer >= a.ms) {
          this.timer = 0;
          this.currentFrame = this.currentFrame === 1 ? 0 : 1;
          if (this.currentFrame === 0) {
            this.animStart = now();
            this.blinkDelay = Math.ceil(Math.random() * Trex.BLINK_TIMING);
          }
        }
      } else {
        this.currentFrame = 0;
        this.timer = 0;
      }
    } else if (this.timer >= a.ms) {
      this.currentFrame = this.currentFrame >= a.frames.length - 1 ? 0 : this.currentFrame + 1;
      this.timer = 0;
    }
  };

  Trex.prototype.draw = function (ctx) {
    var a = Trex.anim[this.status];
    var fx = a.frames[Math.min(this.currentFrame, a.frames.length - 1)];
    sprite(ctx, IMG.TREX, fx, 0, Trex.WIDTH, Trex.HEIGHT,
      this.xPos, this.yPos, Trex.WIDTH, Trex.HEIGHT);
  };

  Trex.prototype.startJump = function () {
    if (this.jumping) return;
    this.setStatus('JUMPING');
    this.jumpVelocity = Trex.INITIAL_JUMP_VELOCITY;
    this.jumping = true;
    this.reachedMinHeight = false;
    this.speedDrop = false;
  };

  Trex.prototype.endJump = function () {
    if (this.reachedMinHeight && this.jumpVelocity < Trex.DROP_VELOCITY) {
      this.jumpVelocity = Trex.DROP_VELOCITY;
    }
  };

  // Returns true when the t-rex lands.
  Trex.prototype.updateJump = function (dt) {
    var frames = dt / MS_PER_FRAME;
    if (this.speedDrop) {
      this.yPos += Math.round(this.jumpVelocity * Trex.SPEED_DROP_COEFFICIENT * frames);
    } else {
      this.yPos += Math.round(this.jumpVelocity * frames);
    }
    this.jumpVelocity += Trex.GRAVITY * frames;
    if (this.yPos < this.minJumpHeight || this.speedDrop) this.reachedMinHeight = true;
    if (this.yPos < Trex.MAX_JUMP_HEIGHT || this.speedDrop) this.endJump();
    if (this.yPos > this.groundYPos) {
      this.land();
      return true;
    }
    return false;
  };

  Trex.prototype.setSpeedDrop = function () {
    this.speedDrop = true;
    this.jumpVelocity = 1;
  };

  Trex.prototype.land = function () {
    this.yPos = this.groundYPos;
    this.jumpVelocity = 0;
    this.jumping = false;
    this.speedDrop = false;
    this.setStatus('RUNNING');
  };

  // ----------------------------------------------------------------- cloud
  var CLOUD = { WIDTH: 46, HEIGHT: 14, MIN_GAP: 100, MAX_GAP: 400, MIN_Y: 30, MAX_Y: 71 };

  function Cloud(x) {
    this.xPos = x;
    this.yPos = rnd(CLOUD.MIN_Y, CLOUD.MAX_Y);
    this.gap = rnd(CLOUD.MIN_GAP, CLOUD.MAX_GAP);
    this.remove = false;
  }

  // ------------------------------------------------------- horizon / world
  var HORIZON = { WIDTH: 600, HEIGHT: 12, YPOS: 127 };

  function Horizon(game) {
    this.game = game;
    this.obstacles = [];
    this.clouds = [new Cloud(game.width * 0.7)];
    this.segX = [];
    this.segType = [];
    this.reset();
  }

  Horizon.prototype.reset = function () {
    this.obstacles = [];
    this.segX = [];
    this.segType = [];
    this.fitSegments();
  };

  // Enough 600px ground segments to cover the whole (variable) world width.
  Horizon.prototype.fitSegments = function () {
    var need = Math.ceil(this.game.width / HORIZON.WIDTH) + 1;
    if (!this.segX.length) { this.segX.push(0); this.segType.push(0); }
    while (this.segX.length < need) {
      this.segX.push(this.segX[this.segX.length - 1] + HORIZON.WIDTH);
      this.segType.push(Math.random() > 0.5 ? HORIZON.WIDTH : 0);
    }
  };

  Horizon.prototype.update = function (dt, speed, withObstacles) {
    var inc = Math.floor(speed * (FPS / 1000) * dt);
    var i;
    for (i = 0; i < this.segX.length; i++) this.segX[i] -= inc;
    while (this.segX[0] <= -HORIZON.WIDTH) {
      this.segX.shift();
      this.segType.shift();
      this.segX.push(this.segX[this.segX.length - 1] + HORIZON.WIDTH);
      this.segType.push(Math.random() > 0.5 ? HORIZON.WIDTH : 0);
    }

    // Clouds drift slowly.
    var cloudSpeed = 0.2 / 1000 * dt * speed;
    for (i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i];
      c.xPos -= Math.ceil(cloudSpeed);
      if (c.xPos + CLOUD.WIDTH <= 0) c.remove = true;
    }
    var last = this.clouds[this.clouds.length - 1];
    if (this.clouds.length < 6 + Math.floor(this.game.width / DEFAULT_WIDTH) &&
      (!last || this.game.width - last.xPos > last.gap) && Math.random() < 0.5) {
      this.clouds.push(new Cloud(this.game.width));
    }
    this.clouds = this.clouds.filter(function (o) { return !o.remove; });

    if (withObstacles) this.updateObstacles(dt, speed);
  };

  Horizon.prototype.updateObstacles = function (dt, speed) {
    for (var i = 0; i < this.obstacles.length; i++) this.obstacles[i].update(dt, speed);
    this.obstacles = this.obstacles.filter(function (o) { return !o.remove; });
    var lastOb = this.obstacles[this.obstacles.length - 1];
    if (!lastOb) {
      this.addObstacle(speed);
    } else if (!lastOb.followingCreated &&
      lastOb.xPos + lastOb.width + lastOb.gap < this.game.width) {
      this.addObstacle(speed);
      lastOb.followingCreated = true;
    }
  };

  Horizon.prototype.addObstacle = function (speed) {
    var type = OBSTACLE_TYPES[rnd(0, OBSTACLE_TYPES.length - 1)];
    this.obstacles.push(new Obstacle(type, this.game.width, speed));
  };

  Horizon.prototype.draw = function (ctx) {
    var i;
    for (i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i];
      sprite(ctx, IMG.CLOUD, 0, 0, CLOUD.WIDTH, CLOUD.HEIGHT, c.xPos, c.yPos, CLOUD.WIDTH, CLOUD.HEIGHT);
    }
    for (i = 0; i < this.segX.length; i++) {
      sprite(ctx, IMG.HORIZON, this.segType[i], 0, HORIZON.WIDTH, HORIZON.HEIGHT,
        this.segX[i], HORIZON.YPOS, HORIZON.WIDTH, HORIZON.HEIGHT);
    }
    for (i = 0; i < this.obstacles.length; i++) this.obstacles[i].draw(ctx);
  };

  // --------------------------------------------------------- distance meter
  var DIGIT = { WIDTH: 10, HEIGHT: 13, DEST_WIDTH: 11 };
  var METER = { UNITS: 5, ACHIEVEMENT: 100, COEFFICIENT: 0.025, FLASH_MS: 250, FLASH_ITER: 3 };

  function toScore(distance) {
    return distance ? Math.round(distance * METER.COEFFICIENT) : 0;
  }

  function pad(n) {
    return ('00000' + n).slice(-METER.UNITS);
  }

  function Meter() {
    this.reset();
  }

  Meter.prototype.reset = function () {
    this.score = 0;
    this.flashing = false;
    this.flashTimer = 0;
    this.flashIter = 0;
    this.visible = true;
    this.lastMilestone = 0;
  };

  // Returns true when a new 100-point milestone is reached.
  Meter.prototype.update = function (dt, score) {
    var reached = false;
    if (!this.flashing) {
      this.score = score;
      var milestone = Math.floor(score / METER.ACHIEVEMENT);
      if (score > 0 && milestone > this.lastMilestone) {
        this.lastMilestone = milestone;
        this.flashing = true;
        this.flashTimer = 0;
        this.flashIter = 0;
        reached = true;
      }
      this.visible = true;
    } else {
      // Flash the reached milestone a few times.
      this.flashTimer += dt;
      if (this.flashTimer < METER.FLASH_MS) {
        this.visible = false;
      } else {
        this.visible = true;
        if (this.flashTimer > METER.FLASH_MS * 2) {
          this.flashTimer = 0;
          this.flashIter++;
          if (this.flashIter > METER.FLASH_ITER) this.flashing = false;
        }
      }
    }
    return reached;
  };

  Meter.prototype.draw = function (ctx, worldWidth, best) {
    var x = worldWidth - DIGIT.DEST_WIDTH * (METER.UNITS + 1);
    var y = 5;
    var i;
    var s = pad(this.score);
    if (this.visible) {
      for (i = 0; i < s.length; i++) this.digit(ctx, x + i * DIGIT.DEST_WIDTH, y, +s[i]);
    }
    if (best > 0) {
      var hx = x - METER.UNITS * 2 * DIGIT.WIDTH;
      var chars = [10, 11, -1].concat(pad(best).split('').map(Number));
      ctx.save();
      ctx.globalAlpha = 0.8;
      for (i = 0; i < chars.length; i++) {
        if (chars[i] >= 0) this.digit(ctx, hx + i * DIGIT.DEST_WIDTH, y, chars[i]);
      }
      ctx.restore();
    }
  };

  Meter.prototype.digit = function (ctx, x, y, value) {
    sprite(ctx, IMG.TEXT, DIGIT.WIDTH * value, 0, DIGIT.WIDTH, DIGIT.HEIGHT, x, y, DIGIT.WIDTH, DIGIT.HEIGHT);
  };

  // ------------------------------------------------------------------ game
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var ui = {
    root: document.getElementById('app'),
    hint: document.getElementById('hint'),
    over: document.getElementById('over-text'),
    paused: document.getElementById('paused'),
    mute: document.getElementById('mute'),
    rotate: document.getElementById('rotate')
  };

  var Game = {
    width: DEFAULT_WIDTH,
    scale: 1,
    dpr: 1,
    offsetX: 0,
    offsetY: 0,
    state: 'waiting',       // waiting | intro | running | crashed
    paused: false,
    speed: CONFIG.SPEED,
    distance: 0,
    runningTime: 0,
    time: 0,
    crashTime: 0,
    best: 0,
    newBest: false,
    touchUI: false,

    init: function () {
      // Best score (no older unprefixed key existed: the previous version did not save it).
      var b = parseInt(store(STORE_BEST), 10);
      this.best = isFinite(b) && b > 0 ? b : 0;
      this.layout();
      this.tRex = new Trex();
      this.horizon = new Horizon(this);
      this.meter = new Meter();
      this.updateMuteButton();
      this.bindEvents();
      this.setState('waiting');
      this.time = now();
      var self = this;
      requestAnimationFrame(function loop() {
        self.frame();
        requestAnimationFrame(loop);
      });
    },

    // Fill the screen: the strip keeps its pixel-art height of 150 units,
    // its width adapts to the window shape.
    layout: function () {
      var vw = Math.max(1, window.innerWidth);
      var vh = Math.max(1, window.innerHeight);
      var dpr = Math.min(window.devicePixelRatio || 1, 3);
      var s = Math.min(vh * 0.5 / HEIGHT, vw / MIN_WIDTH);
      if (vw / s > MAX_WIDTH) s = vw / MAX_WIDTH;
      // Whole device pixels per sprite pixel when the scale is large enough (crisp pixel art).
      // (Only when that costs less than a fifth of the size.)
      var whole = Math.floor(s * dpr);
      if (whole >= 2 && whole / (s * dpr) > 0.8) s = whole / dpr;
      this.scale = s;
      this.dpr = dpr;
      this.width = Math.round(vw / s);
      this.offsetX = Math.round((vw - this.width * s) / 2);
      // Strip slightly above centre so the hints fit below it.
      this.offsetY = Math.round(Math.max(0, (vh - HEIGHT * s) * 0.42));
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      canvas.style.width = vw + 'px';
      canvas.style.height = vh + 'px';
      document.documentElement.style.setProperty('--strip-top', this.offsetY + 'px');
      document.documentElement.style.setProperty('--strip-bottom', (this.offsetY + HEIGHT * s) + 'px');
      document.documentElement.style.setProperty('--px', s + 'px');
      ui.root.classList.toggle('portrait', vh > vw * 1.15);
      if (this.horizon) this.horizon.fitSegments();
      this.setSpeedForWidth(this.speed);
      this.render();
    },

    // Narrow screens run a little slower, like the original game.
    setSpeedForWidth: function (speed) {
      if (this.width < DEFAULT_WIDTH) {
        var mobile = speed * this.width / DEFAULT_WIDTH * CONFIG.MOBILE_SPEED_COEFFICIENT;
        this.speed = mobile > speed ? speed : mobile;
      } else {
        this.speed = speed;
      }
    },

    setState: function (state) {
      this.state = state;
      ui.root.setAttribute('data-state', state);
    },

    setPaused: function (p) {
      if (p && (this.state === 'running' || this.state === 'intro')) {
        this.paused = true;
        if (this.tRex.jumping) this.tRex.endJump();
      } else if (!p) {
        this.paused = false;
        this.time = now();
      }
      ui.root.classList.toggle('is-paused', this.paused);
    },

    // ---------------------------------------------------------- input
    bindEvents: function () {
      var self = this;
      window.addEventListener('resize', function () { self.layout(); });
      window.addEventListener('orientationchange', function () {
        setTimeout(function () { self.layout(); }, 150);
      });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) self.setPaused(true);
      });
      window.addEventListener('blur', function () { self.setPaused(true); });

      document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var code = e.code || '';
        if (KEYS.JUMP[code] || KEYS.DROP[code] || KEYS.RESTART[code]) e.preventDefault();
        if (e.repeat) return;
        if (code === 'KeyM') { self.toggleMute(); return; }
        if (code === 'KeyP' || code === 'Escape') {
          if (self.paused) self.setPaused(false); else self.setPaused(true);
          return;
        }
        if (KEYS.JUMP[code]) self.press();
        else if (KEYS.DROP[code]) self.drop();
        else if (KEYS.RESTART[code] && self.state === 'crashed') self.tryRestart(true);
      });
      document.addEventListener('keyup', function (e) {
        var code = e.code || '';
        if (KEYS.JUMP[code]) self.release();
        else if (KEYS.DROP[code]) self.tRex.speedDrop = false;
      });

      var pointer = null;
      canvas.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.pointerType === 'touch' || e.pointerType === 'pen') self.setTouchUI(true);
        e.preventDefault();
        pointer = { id: e.pointerId, y: e.clientY, dropped: false };
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        self.press();
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!pointer || pointer.id !== e.pointerId || pointer.dropped) return;
        // Swipe down while in the air: drop faster.
        if (e.clientY - pointer.y > 28) {
          pointer.dropped = true;
          self.drop();
        }
      });
      var up = function (e) {
        if (!pointer || pointer.id !== e.pointerId) return;
        pointer = null;
        self.release();
      };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

      ui.mute.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      ui.mute.addEventListener('click', function (e) {
        e.stopPropagation();
        self.toggleMute();
        ui.mute.blur();
      });
      ui.paused.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.setPaused(false);
      });
      if (window.matchMedia && matchMedia('(pointer: coarse)').matches) this.setTouchUI(true);
    },

    setTouchUI: function (on) {
      if (this.touchUI === on) return;
      this.touchUI = on;
      ui.root.classList.toggle('touch', on);
    },

    press: function () {
      Sound.unlock();
      if (this.paused) { this.setPaused(false); return; }
      if (this.state === 'crashed') { this.tryRestart(false); return; }
      if (this.state === 'waiting') this.startIntro();
      if (!this.tRex.jumping) {
        Sound.play('jump');
        this.tRex.startJump();
      }
    },

    release: function () {
      if (this.state === 'running' || this.state === 'intro') this.tRex.endJump();
    },

    drop: function () {
      if ((this.state === 'running' || this.state === 'intro') && this.tRex.jumping && !this.paused) {
        this.tRex.setSpeedDrop();
      }
    },

    toggleMute: function () {
      Sound.muted = !Sound.muted;
      store(STORE_MUTED, Sound.muted ? '1' : '0');
      if (!Sound.muted) Sound.unlock();
      this.updateMuteButton();
    },

    updateMuteButton: function () {
      ui.mute.classList.toggle('off', Sound.muted);
      ui.mute.setAttribute('aria-label', Sound.muted ? 'Unmute sound' : 'Mute sound');
      ui.mute.title = Sound.muted ? 'Sound off (M)' : 'Sound on (M)';
    },

    // ----------------------------------------------------- game flow
    startIntro: function () {
      this.setState('intro');
      this.introTime = 0;
      this.runningTime = 0;
      this.distance = 0;
      this.setSpeedForWidth(CONFIG.SPEED);
    },

    tryRestart: function (force) {
      if (!force && now() - this.crashTime < CONFIG.GAMEOVER_CLEAR_TIME) return;
      this.restart();
    },

    restart: function () {
      this.distance = 0;
      this.runningTime = 0;
      this.newBest = false;
      this.setSpeedForWidth(CONFIG.SPEED);
      this.horizon.reset();
      this.meter.reset();
      this.tRex.land();
      this.tRex.xPos = Trex.START_X_POS;
      this.time = now();
      Sound.play('jump');
      this.setState('running');
    },

    gameOver: function () {
      Sound.play('hit');
      if (this.touchUI && navigator.vibrate) {
        try { navigator.vibrate(150); } catch (e) { /* ignore */ }
      }
      this.tRex.setStatus('CRASHED');
      this.crashTime = now();
      var score = toScore(Math.ceil(this.distance));
      this.meter.score = score;
      this.meter.flashing = false;
      this.meter.visible = true;
      if (score > this.best) {
        this.best = score;
        this.newBest = true;
        store(STORE_BEST, score);
      }
      ui.over.textContent = this.newBest ? 'New best score!' : '';
      this.setState('crashed');
    },

    frame: function () {
      var t = now();
      var dt = Math.min(t - this.time, 50);
      this.time = t;
      if (!this.paused) this.update(dt);
      this.render();
    },

    update: function (dt) {
      var tRex = this.tRex;
      if (this.state === 'waiting' || this.state === 'crashed') {
        if (this.state === 'waiting') tRex.update(dt);
        return;
      }
      if (tRex.jumping) tRex.updateJump(dt);

      if (this.state === 'intro') {
        // A short beat before the ground starts moving.
        this.introTime += dt;
        if (this.introTime >= CONFIG.INTRO_TIME) this.setState('running');
        tRex.update(dt);
        return;
      }

      this.runningTime += dt;
      var hasObstacles = this.runningTime > CONFIG.CLEAR_TIME;
      this.horizon.update(dt, this.speed, hasObstacles);

      var first = this.horizon.obstacles[0];
      if (hasObstacles && first && checkForCollision(first, tRex)) {
        this.gameOver();
        return;
      }
      this.distance += this.speed * dt / MS_PER_FRAME;
      if (this.speed < CONFIG.MAX_SPEED) this.speed += CONFIG.ACCELERATION * dt / MS_PER_FRAME;
      var score = toScore(Math.ceil(this.distance));
      if (score > 99999) { this.distance = 0; score = 0; this.meter.lastMilestone = 0; }
      if (this.meter.update(dt, score)) Sound.play('score');
      tRex.update(dt);
    },

    render: function () {
      if (!this.tRex) return;
      var k = this.scale * this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#f7f7f7';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(k, 0, 0, k, this.offsetX * this.dpr, this.offsetY * this.dpr);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, -20, this.width, HEIGHT + 40);
      ctx.clip();
      this.horizon.draw(ctx);
      this.tRex.draw(ctx);
      // While waiting the meter only appears if there is a best score to show.
      if (this.state !== 'waiting' || this.best > 0) this.meter.draw(ctx, this.width, this.best);
      if (this.state === 'crashed') this.drawGameOver(ctx);
      ctx.restore();
    },

    drawGameOver: function (c) {
      var cx = this.width / 2;
      sprite(c, IMG.TEXT, 0, 13, 191, 11, Math.round(cx - 191 / 2), Math.round((HEIGHT - 25) / 3), 191, 11);
      sprite(c, IMG.RESTART, 0, 0, 36, 32, Math.round(cx - 18), HEIGHT / 2, 36, 32);
    }
  };

  // ------------------------------------------------------------- boot
  var names = Object.keys(IMG_SRC);
  var loaded = 0;
  names.forEach(function (name) {
    var img = new Image();
    img.onload = function () {
      if (++loaded === names.length) Game.init();
    };
    img.src = IMG_SRC[name];
    IMG[name] = img;
  });
})();
