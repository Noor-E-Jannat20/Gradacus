/*
 * RubberSegment — vanilla JS port of the React Bits <RubberSegment /> component
 * (JavaScript + CSS variant). Same props, same behaviour: a rubbery thumb that
 * stretches across old and new slot on tap, squashes on landing, can be dragged
 * with rubber-band resistance and flicked, with full keyboard support.
 * The `motion` dependency is replaced by a small built-in tween/spring engine.
 *
 * Differences from the React version:
 *  - items accept `labelHtml` (trusted markup) as an alternative to `label`,
 *    and `icon` as an HTML string.
 *  - imperative API instead of the controlled `value` prop:
 *      seg.setValue('week', true)   // animate (default) or false to jump
 *      seg.getValue()
 *      seg.destroy()
 *
 * Usage:
 *   const seg = RubberSegment(hostEl, {
 *     items: ['Day', 'Week', 'Month'], defaultValue: 'Week',
 *     onChange: (value, index) => console.log(value, index)
 *   });
 */
(function () {
  'use strict';

  var DILATE = 0.19, HANDOFF = 0.15, FLICK = 110, MAX_VELOCITY = 2000;
  var DEADZONE = 4, SLOP = 10, RUBBER = 0.55;
  var SIZES = {
    sm: { height: 28, font: 12, pad: 10, min: 36 },
    md: { height: 36, font: 13, pad: 14, min: 44 },
    lg: { height: 44, font: 14, pad: 18, min: 48 }
  };
  var SPRING_UI = { duration: 0.3, bounce: 0 };
  var SPRING_MOMENTUM = { duration: 0.4, bounce: 0.2 };
  var SPRING_RELAX = { duration: 0.16, bounce: 0 };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function rubber(over, dim) { return (over * dim * RUBBER) / (dim + RUBBER * Math.abs(over)); }
  function project(v, glide) {
    var d = 1 - 0.1 * Math.pow(0.05, glide / 100);
    return ((v / 1000) * d) / (1 - d);
  }
  function velocityOf(hist, now) {
    var recent = hist.filter(function (h) { return now - h[0] <= 100; });
    if (recent.length < 2) return 0;
    var a = recent[0], b = recent[recent.length - 1];
    return b[0] - a[0] >= 8 ? ((b[1] - a[1]) / (b[0] - a[0])) * 1000 : 0;
  }
  function nearestSlot(slots, x) {
    var best = 0;
    for (var i = 1; i < slots.length; i++) {
      if (Math.abs((slots[i].l + slots[i].r) / 2 - x) < Math.abs((slots[best].l + slots[best].r) / 2 - x)) best = i;
    }
    return best;
  }

  /* cubic-bezier(0.23, 1, 0.32, 1) easing */
  function bezier(x1, y1, x2, y2) {
    function cx(t) { return 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t; }
    function cy(t) { return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0, hi = 1, t = x;
      for (var i = 0; i < 24; i++) {
        t = (lo + hi) / 2;
        if (cx(t) < x) lo = t; else hi = t;
      }
      return cy(t);
    };
  }
  var EASE_OUT = bezier(0.23, 1, 0.32, 1);

  /* ---- tiny animation engine (stand-in for motion's animate/useMotionValue) ---- */
  function MotionValue(x) { this.x = x; this.vel = 0; this.anim = null; this.prev = x; }
  MotionValue.prototype.get = function () { return this.x; };
  MotionValue.prototype.set = function (n) { this.x = n; };
  MotionValue.prototype.jump = function (n) { this.x = n; this.prev = n; this.vel = 0; this.anim = null; };
  MotionValue.prototype.stop = function () { this.anim = null; };
  MotionValue.prototype.getVelocity = function () { return this.vel; };

  function RubberSegment(host, userProps) {
    var P = Object.assign({
      items: [], defaultValue: undefined, onChange: null,
      trackColor: '#27272a', thumbColor: '#fafafa', textColor: '#fafafa', activeTextColor: '#18181b',
      size: 'md', radius: 10, inset: 3, equalSlots: true, stretch: 100, squash: 3, speed: 1, glide: 75,
      draggable: true, disabled: false, className: '', ariaLabel: 'Segmented control'
    }, userProps || {});

    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var list = P.items.map(function (it) { return typeof it === 'string' ? { value: it, label: it } : it; });
    var current = P.defaultValue != null ? P.defaultValue : (list[0] && list[0].value);
    var index = Math.max(0, list.findIndex(function (it) { return it.value === current; }));

    var preset = SIZES[P.size] || SIZES.md;
    var thumbRadius = Math.max(0, P.radius - P.inset);
    var inset = P.inset;

    /* ---- DOM ---- */
    host.textContent = '';
    var track = document.createElement('div');
    track.className = 'rubber-segment' + (P.className ? ' ' + P.className : '');
    track.setAttribute('role', 'radiogroup');
    track.setAttribute('aria-label', P.ariaLabel);
    if (P.disabled) track.setAttribute('aria-disabled', 'true');
    if (P.equalSlots) track.setAttribute('data-equal', '');
    if (P.draggable && !P.disabled) track.setAttribute('data-draggable', '');
    var vars = {
      '--rs-track': P.trackColor, '--rs-thumb': P.thumbColor, '--rs-ink': P.textColor,
      '--rs-ink-active': P.activeTextColor, '--rs-radius': P.radius + 'px', '--rs-inset': inset + 'px',
      '--rs-thumb-radius': thumbRadius + 'px', '--rs-h': preset.height + 'px', '--rs-font': preset.font + 'px',
      '--rs-pad': preset.pad + 'px', '--rs-min': preset.min + 'px'
    };
    Object.keys(vars).forEach(function (k) { track.style.setProperty(k, vars[k]); });

    function fillContent(el, item) {
      if (item.icon) { var s = document.createElement('span'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = item.icon; el.appendChild(s); }
      var t = document.createElement('span');
      if (item.labelHtml != null) t.innerHTML = item.labelHtml; else t.textContent = item.label == null ? '' : item.label;
      el.appendChild(t);
    }

    var itemEls = list.map(function (item, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rubber-segment__item';
      b.setAttribute('role', 'radio');
      b.disabled = !!P.disabled;
      fillContent(b, item);
      b.addEventListener('pointerdown', function (e) { onPointerDown(e, i); });
      b.addEventListener('keydown', onKeyDown);
      track.appendChild(b);
      return b;
    });

    var thumb = document.createElement('div');
    thumb.className = 'rubber-segment__thumb';
    thumb.setAttribute('aria-hidden', 'true');
    list.forEach(function (item) {
      var c = document.createElement('span');
      c.className = 'rubber-segment__item rubber-segment__copy';
      fillContent(c, item);
      thumb.appendChild(c);
    });
    track.appendChild(thumb);
    host.appendChild(track);

    function syncAria() {
      itemEls.forEach(function (b, i) {
        b.setAttribute('aria-checked', i === index ? 'true' : 'false');
        b.tabIndex = i === index ? 0 : -1;
      });
    }
    syncAria();

    /* ---- state ---- */
    var slots = [], box = null, committed = index, handoff = 0, drag = null, gen = 0;
    var edgeL = new MotionValue(0), edgeR = new MotionValue(0), innerW = 0;
    var raf = 0, lastT = 0, destroyed = false;
    var anims = [];

    function paintClip() {
      var l = Math.max(0, edgeL.get()), r = Math.max(0, innerW - edgeR.get());
      thumb.style.clipPath = 'inset(0 ' + r + 'px 0 ' + l + 'px round ' + thumbRadius + 'px)';
    }

    function loop(now) {
      var dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
      lastT = now;
      var alive = [];
      anims.forEach(function (a) {
        if (a.mv.anim !== a) return;                     // superseded or stopped
        var mv = a.mv;
        if (a.type === 'tween') {
          a.elapsed += dt;
          var p = Math.min(1, a.elapsed / a.dur);
          mv.x = a.from + (a.to - a.from) * EASE_OUT(p);
          if (p >= 1) { mv.x = a.to; finish(a); return; }
        } else {
          var h = 1 / 240, n = Math.max(1, Math.ceil(dt / h)), s = dt / n;
          for (var i = 0; i < n; i++) {
            var acc = -a.k * (mv.x - a.to) - a.c * a.v;
            a.v += acc * s;
            mv.x += a.v * s;
          }
          if (Math.abs(mv.x - a.to) < 0.01 && Math.abs(a.v) < 0.5) { mv.x = a.to; finish(a); return; }
        }
        alive.push(a);
      });
      anims = alive;
      [edgeL, edgeR].forEach(function (mv) {
        mv.vel = (mv.x - mv.prev) / dt;
        mv.prev = mv.x;
      });
      paintClip();
      if (anims.length) raf = requestAnimationFrame(loop); else raf = 0;
    }
    function finish(a) { a.mv.anim = null; a.mv.vel = 0; if (a.resolve) a.resolve(); }
    function kick() {
      if (raf || destroyed) return;
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    }
    function paintNow() { paintClip(); }

    function animateTween(mv, to, duration) {
      return new Promise(function (resolve) {
        var a = { mv: mv, type: 'tween', from: mv.x, to: to, dur: Math.max(0.001, duration), elapsed: 0, resolve: resolve };
        mv.anim = a; anims.push(a); kick();
      });
    }
    function animateSpring(mv, to, cfg, velocity) {
      return new Promise(function (resolve) {
        var d = Math.max(0.001, cfg.duration);
        var k = Math.pow((2 * Math.PI) / d, 2);
        var c = 2 * (1 - cfg.bounce) * Math.sqrt(k);
        var a = { mv: mv, type: 'spring', to: to, k: k, c: c, v: velocity || 0, resolve: resolve };
        mv.anim = a; anims.push(a); kick();
      });
    }
    function stopAll() { edgeL.stop(); edgeR.stop(); }

    function t(seconds) { return seconds / P.speed; }

    function jumpTo(i) {
      var s = slots[i];
      if (!s) return;
      clearTimeout(handoff);
      gen += 1;
      edgeL.jump(s.l);
      edgeR.jump(s.r);
      paintNow();
    }

    function measure() {
      if (destroyed) return;
      var rect = track.getBoundingClientRect();
      if (!rect.width) return;                           // hidden (display:none) — wait for the next resize
      box = rect;
      slots = list.map(function (_, i) {
        var r = itemEls[i].getBoundingClientRect();
        return { l: r.left - rect.left - inset, r: r.right - rect.left - inset };
      });
      innerW = rect.width - inset * 2;
      jumpTo(committed);
    }

    function commit(i) {
      committed = i;
      if (i === index) return;
      index = i;
      current = list[i].value;
      syncAria();
      if (P.onChange) P.onChange(list[i].value, i);
    }

    function land(to, v, flick, withSquash) {
      var b = slots[to];
      if (!b) return;
      var g = ++gen;
      var dir = Math.sign((b.l + b.r) / 2 - (edgeL.get() + edgeR.get()) / 2) || 1;
      var lead = dir > 0 ? edgeR : edgeL, leadTo = dir > 0 ? b.r : b.l;
      var trail = dir > 0 ? edgeL : edgeR, trailTo = dir > 0 ? b.l : b.r;
      function velocityFor(mv) { return clamp(v === null ? mv.getVelocity() : v, -MAX_VELOCITY, MAX_VELOCITY); }
      var cfg = flick ? SPRING_MOMENTUM : SPRING_UI;
      animateSpring(lead, leadTo, { duration: t(flick ? 0.4 : 0.3), bounce: cfg.bounce }, velocityFor(lead));
      var trailVelocity = velocityFor(trail);
      if (!withSquash || P.squash <= 0) {
        animateSpring(trail, trailTo, { duration: t(0.3), bounce: 0 }, trailVelocity);
        return;
      }
      animateSpring(trail, trailTo + dir * P.squash, { duration: t(0.3), bounce: 0 }, trailVelocity).then(function () {
        if (gen === g) animateSpring(trail, trailTo, { duration: t(0.16), bounce: 0 }, 0);
      });
    }

    function travel(from, to) {
      var a = slots[from], b = slots[to];
      if (!a || !b) return;
      clearTimeout(handoff);
      gen += 1;
      if (reduce) { edgeL.jump(b.l); edgeR.jump(b.r); paintNow(); return; }
      var u = P.stretch / 100;
      animateTween(edgeL, b.l + (Math.min(a.l, b.l) - b.l) * u, t(DILATE));
      animateTween(edgeR, b.r + (Math.max(a.r, b.r) - b.r) * u, t(DILATE));
      handoff = setTimeout(function () { land(to, null, false, true); }, t(HANDOFF) * 1000);
    }

    function localX(e) { return e.clientX - (box ? box.left : 0) - inset; }

    function onPointerDown(e, i) {
      if (P.disabled || drag || e.button !== 0) return;
      box = track.getBoundingClientRect();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
      var x = localX(e);
      var onThumb = P.draggable && x >= edgeL.get() && x <= edgeR.get();
      drag = { id: e.pointerId, x0: x, slot: i, onThumb: onThumb, live: false, offset: 0, w: 0, hist: [[e.timeStamp, x]] };
      if (onThumb) {
        clearTimeout(handoff);
        gen += 1;
        stopAll();
      } else if (!reduce) {
        e.currentTarget.setAttribute('data-pressed', '');
      }
    }

    function onPointerMove(e) {
      var d = drag;
      if (!d || e.pointerId !== d.id || !d.onThumb) return;
      var x = localX(e);
      d.hist.push([e.timeStamp, x]);
      if (d.hist.length > 8) d.hist.shift();
      if (!d.live) {
        if (Math.abs(x - d.x0) < DEADZONE) return;
        d.live = true;
        d.offset = x - edgeL.get();
        d.w = edgeR.get() - edgeL.get();
        track.setAttribute('data-held', '');
      }
      var width = innerW, l = x - d.offset, maxL = width - d.w;
      if (reduce) {
        var c = clamp(l, 0, maxL);
        edgeL.set(c); edgeR.set(c + d.w);
      } else if (l < 0) {
        edgeL.set(0); edgeR.set(d.w - rubber(-l, d.w));
      } else if (l > maxL) {
        edgeR.set(width); edgeL.set(maxL + rubber(l - maxL, d.w));
      } else {
        edgeL.set(l); edgeR.set(l + d.w);
      }
      paintNow();
      kick();                                            // keep velocity tracking alive while dragging
    }

    function release() {
      var d = drag;
      drag = null;
      track.removeAttribute('data-held');
      var el = itemEls[d.slot];
      if (el) el.removeAttribute('data-pressed');
      return d;
    }

    function onPointerUp(e) {
      var d = drag;
      if (!d || e.pointerId !== d.id) return;
      release();
      var x = localX(e);
      if (!d.live) {
        if (Math.abs(x - d.x0) <= SLOP && d.slot !== committed) {
          var from = committed;
          commit(d.slot);
          travel(from, d.slot);
        }
        return;
      }
      var v = velocityOf(d.hist, e.timeStamp);
      var flick = Math.abs(v) > FLICK;
      var to = nearestSlot(slots, (edgeL.get() + edgeR.get()) / 2 + project(v, P.glide));
      if (flick && to === committed) to = clamp(to + Math.sign(v), 0, list.length - 1);
      commit(to);
      if (reduce) jumpTo(to); else land(to, v, flick, flick);
    }

    function onPointerCancel(e) {
      var d = drag;
      if (!d || e.pointerId !== d.id) return;
      release();
      if (!d.live) return;
      if (reduce) jumpTo(committed); else land(committed, null, false, false);
    }

    function onKeyDown(e) {
      if (P.disabled) return;
      var last = list.length - 1, next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(last, index + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, index - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      if (next === null) return;
      e.preventDefault();
      if (next === index) return;
      commit(next);
      jumpTo(next);
      if (itemEls[next]) itemEls[next].focus();
    }

    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', onPointerUp);
    track.addEventListener('pointercancel', onPointerCancel);
    track.addEventListener('lostpointercapture', onPointerCancel);

    var ro = new ResizeObserver(measure);
    ro.observe(track);
    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

    return {
      element: track,
      getValue: function () { return current; },
      setValue: function (value, animate) {
        var i = list.findIndex(function (it) { return it.value === value; });
        if (i < 0 || drag) return;
        if (i === index) { committed = i; return; }
        var from = committed;
        committed = i; index = i; current = value;
        syncAria();
        if (animate === false || !slots[i] || !box) { jumpTo(i); return; }
        travel(from, i);
      },
      destroy: function () {
        destroyed = true;
        clearTimeout(handoff);
        cancelAnimationFrame(raf);
        anims = [];
        ro.disconnect();
        host.textContent = '';
      }
    };
  }

  window.RubberSegment = RubberSegment;
})();
