/*
 * CometDial — vanilla JS port of the React Bits <CometDial /> component
 * (JavaScript + CSS variant). Same props, geometry, drag/flick/keyboard behaviour
 * and comet trail. The `motion` dependency is replaced by a small built-in
 * spring so no extra library is needed.
 *
 * Extras for dashboards:
 *   readOnly  – display-only graph: no pointer/keyboard input, not dimmed,
 *               exposed to assistive tech as a progressbar.
 *   caption   – small text under the figure (e.g. "complete").
 *
 * Usage:
 *   const dial = CometDial(hostEl, { defaultValue: 0, readOnly: true, caption: 'complete' });
 *   dial.setValue(42);   // launches the reading on the tap spring
 *   dial.replay();       // restart the sweep from min to the current value
 *   dial.update({ accent: '#fff' });
 *   dial.destroy();
 */
(function () {
  'use strict';

  var R = 80, DEAD = 44, K = 12, V_FULL = 4, V_FLICK = 2;
  var TAU_FOLLOW = 0.06, TAU_V = 0.05, DECEL = 0.99, DRAG_PX = 10, STALE_MS = 80;

  var DEFAULTS = {
    value: undefined, defaultValue: 62, min: 0, max: 100, step: 1, unit: '%', label: 'Level',
    accent: '#f5f5f5', ink: '#fdfdfd', size: 250, sweep: 320, thickness: 5, speed: 25,
    tapBounce: 0.2, flickBounce: 0.1, momentum: 1, cometReach: 180, cometWidth: 12,
    disabled: false, readOnly: false, caption: '', onChange: null, onChangeEnd: null, className: ''
  };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function velocityOf(hist) {
    if (hist.length < 2) return 0;
    var a = hist[0], b = hist[hist.length - 1];
    return ((b[1] - a[1]) / Math.max(1, b[0] - a[0])) * 1000;
  }
  function decimalsOf(step) {
    var s = String(step), i = s.indexOf('.');
    return i === -1 ? 0 : s.length - i - 1;
  }
  function pointAt(deg) {
    var a = (deg * Math.PI) / 180;
    return [100 + Math.cos(a) * R, 100 + Math.sin(a) * R];
  }
  function arcPath(a0, a1) {
    var p0 = pointAt(a0), p1 = pointAt(a1);
    return 'M ' + p0[0].toFixed(3) + ' ' + p0[1].toFixed(3) + ' A ' + R + ' ' + R + ' 0 ' +
      (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + p1[0].toFixed(3) + ' ' + p1[1].toFixed(3);
  }

  function CometDial(host, userProps) {
    var P = Object.assign({}, DEFAULTS, userProps || {});
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    var range = Math.max(1e-9, P.max - P.min);
    var gap = 360 - P.sweep;
    var start = 90 + gap / 2;
    var end = start + P.sweep;
    var decimals = decimalsOf(P.step);
    var k = 200 + (clamp(P.speed, 0, 100) / 100) * 700;
    var crit = 2 * Math.sqrt(k);
    var inert = P.disabled || P.readOnly;

    function snap(v) {
      return P.step > 0
        ? clamp(Math.round((v - P.min) / P.step) * P.step + P.min, P.min, P.max)
        : clamp(v, P.min, P.max);
    }

    var target = clamp(P.value != null ? P.value : P.defaultValue, P.min, P.max);

    /* ---- DOM ---- */
    host.textContent = '';
    var root = document.createElement('div');
    root.className = 'comet-dial' + (P.className ? ' ' + P.className : '');
    if (P.disabled) root.setAttribute('data-disabled', '');
    if (P.readOnly) root.setAttribute('data-readonly', '');
    root.style.setProperty('--cd-accent', P.accent);
    root.style.setProperty('--cd-ink', P.ink);
    root.style.setProperty('--cd-size', P.size + 'px');
    root.style.setProperty('--cd-figure', Math.round(P.size * 0.16) + 'px');

    var cometPaths = '';
    for (var j = 0; j < K; j++) cometPaths += '<path style="opacity:0"></path>';
    root.innerHTML =
      '<svg class="comet-dial__ring" viewBox="0 0 200 200">' +
      '<path class="comet-dial__track"></path><path class="comet-dial__lit"></path>' +
      '<g class="comet-dial__comet">' + cometPaths + '</g><circle class="comet-dial__head"></circle></svg>' +
      '<div class="comet-dial__readout" aria-hidden="true"><span class="comet-dial__value">' +
      '<span class="comet-dial__figure"></span>' + (P.unit ? '<span class="comet-dial__unit"></span>' : '') +
      '</span></div>' + (P.caption ? '<div class="comet-dial__caption" aria-hidden="true"></div>' : '');
    host.appendChild(root);

    var svg = root.querySelector('svg');
    var track = svg.querySelector('.comet-dial__track');
    var lit = svg.querySelector('.comet-dial__lit');
    var head = svg.querySelector('.comet-dial__head');
    var comet = Array.prototype.slice.call(svg.querySelectorAll('.comet-dial__comet path'));
    var figure = root.querySelector('.comet-dial__figure');
    var unitEl = root.querySelector('.comet-dial__unit');
    var capEl = root.querySelector('.comet-dial__caption');
    if (unitEl) unitEl.textContent = P.unit;
    if (capEl) capEl.textContent = P.caption;

    track.setAttribute('d', arcPath(start, end));
    track.setAttribute('stroke-width', P.thickness);
    lit.setAttribute('stroke-width', P.thickness);
    head.setAttribute('r', P.thickness * 1.8);

    svg.setAttribute('aria-label', P.label);
    svg.setAttribute('aria-valuemin', P.min);
    svg.setAttribute('aria-valuemax', P.max);
    if (P.readOnly) {
      svg.setAttribute('role', 'progressbar');
    } else {
      svg.setAttribute('role', 'slider');
      svg.setAttribute('tabindex', P.disabled ? '-1' : '0');
    }
    if (P.disabled) svg.setAttribute('aria-disabled', 'true');

    /* ---- spring-driven "reading" (stand-in for motion's MotionValue) ---- */
    var reading = {
      x: target, v: 0, to: target, k: k, c: crit, active: false,
      get: function () { return this.x; },
      set: function (n) { this.x = n; },
      jump: function (n) { this.x = n; this.v = 0; this.to = n; this.active = false; },
      stop: function () { this.active = false; },
      velocity: function () { return this.active ? this.v : 0; },
      isAnimating: function () { return this.active; },
      animate: function (to, damping, velocity) {
        this.to = to; this.c = damping; this.v = velocity || 0; this.active = true;
      },
      step: function (dt) {
        if (!this.active) return;
        var h = 1 / 240, n = Math.max(1, Math.ceil(dt / h)), s = dt / n;
        for (var i = 0; i < n; i++) {
          var a = -this.k * (this.x - this.to) - this.c * this.v;
          this.v += a * s;
          this.x += this.v * s;
        }
        if (Math.abs(this.x - this.to) < range * 1e-4 && Math.abs(this.v) < range * 1e-3) {
          this.x = this.to; this.v = 0; this.active = false;
        }
      }
    };

    var grip = null, unbind = null, destroyed = false;
    var L = { raf: 0, last: 0, v: 0, rPrev: null, text: '', valueText: '' };

    function commit(v, finished, detail) {
      var s = snap(v);
      if (s !== target) {
        target = s;
        if (P.onChange) P.onChange(s);
      }
      if (finished && P.onChangeEnd) P.onChangeEnd(s, detail || { velocity: 0, bounce: P.tapBounce });
    }

    function tick(now) { paint(now); }
    function wake() {
      if (L.raf || destroyed) return;
      L.last = performance.now();
      L.rPrev = null;
      L.raf = requestAnimationFrame(tick);
    }
    function launch(to, bounce, velocity) {
      if (velocity === undefined) velocity = reading.velocity();
      reading.stop();
      if (reduce) { reading.jump(to); wake(); return; }
      reading.animate(to, crit * (1 - clamp(bounce, 0, 0.9)), velocity);
      wake();
    }

    function paint(now) {
      if (destroyed) { L.raf = 0; return; }
      var dt = clamp((now - L.last) / 1000, 0, 0.05);
      L.last = now;
      if (grip && grip.at != null) {
        if (reduce) reading.jump(grip.at);
        else reading.set(reading.get() + (grip.at - reading.get()) * (1 - Math.exp(-dt / TAU_FOLLOW)));
      } else {
        reading.step(dt);
      }
      var r = reading.get();
      var vRaw = L.rPrev == null || dt === 0 || reduce ? 0 : (r - L.rPrev) / dt / range;
      L.rPrev = r;
      L.v += (vRaw - L.v) * (1 - Math.exp(-dt / TAU_V));
      var v = L.v;
      var s = clamp(Math.abs(v) / V_FULL, 0, 1);
      var dir = Math.sign(v) || 1;
      var f = clamp((r - P.min) / range, 0, 1);
      var ang = start + f * P.sweep;

      lit.setAttribute('d', f > 0.0005 ? arcPath(start, ang) : '');
      var hp = pointAt(ang);
      head.setAttribute('cx', hp[0].toFixed(3));
      head.setAttribute('cy', hp[1].toFixed(3));

      var seg = (P.cometReach * s) / K;
      for (var i = 0; i < K; i++) {
        var el = comet[i];
        var a0 = dir > 0 ? ang - (i + 1) * seg : ang + i * seg;
        var a1 = dir > 0 ? ang - i * seg : ang + (i + 1) * seg;
        a0 = clamp(a0, start, end);
        a1 = clamp(a1, start, end);
        if (seg < 0.01 || a1 - a0 < 0.01) {
          if (el.style.opacity !== '0') el.style.opacity = '0';
          continue;
        }
        var w = 1 - i / K;
        el.setAttribute('d', arcPath(a0, a1));
        el.setAttribute('stroke-width', (P.thickness + P.cometWidth * w * s).toFixed(2));
        el.style.opacity = (w * s).toFixed(3);
      }

      var shown = clamp(r, P.min, P.max).toFixed(decimals);
      if (shown !== L.text) {
        L.text = shown;
        figure.textContent = shown;
        svg.setAttribute('aria-valuenow', shown);
      }
      var valueText = target + P.unit;
      if (valueText !== L.valueText) {
        L.valueText = valueText;
        svg.setAttribute('aria-valuetext', valueText);
      }

      var moving = !!grip || reading.isAnimating() || Math.abs(v) > 0.002;
      if (!moving) {
        comet.forEach(function (el) { if (el.style.opacity !== '0') el.style.opacity = '0'; });
      }
      L.raf = moving ? requestAnimationFrame(tick) : 0;
    }

    /* ---- pointer input ---- */
    function localPoint(cx, cy) {
      var b = svg.getBoundingClientRect();
      return [((cx - b.left) / b.width) * 200 - 100, ((cy - b.top) / b.height) * 200 - 100];
    }
    function angleAt(cx, cy) {
      var p = localPoint(cx, cy);
      var rel = ((Math.atan2(p[1], p[0]) * 180) / Math.PI - start + 720) % 360;
      if (rel > P.sweep) {
        rel = grip && grip.side ? (grip.side === 'hi' ? P.sweep : 0) : rel < P.sweep + gap / 2 ? P.sweep : 0;
      } else if (grip) {
        grip.side = rel > P.sweep / 2 ? 'hi' : 'lo';
      }
      return P.min + (rel / P.sweep) * range;
    }

    function move(e) {
      if (!grip || grip.id !== e.pointerId) return;
      if (!grip.moved) {
        if (Math.hypot(e.clientX - grip.x0, e.clientY - grip.y0) < DRAG_PX) return;
        grip.moved = true;
        reading.stop();
      }
      grip.at = angleAt(e.clientX, e.clientY);
      grip.hist.push([performance.now(), grip.at]);
      if (grip.hist.length > 4) grip.hist.shift();
      commit(grip.at, false);
      wake();
    }
    function up(e) {
      if (!grip || grip.id !== e.pointerId) return;
      var g = grip;
      grip = null;
      if (unbind) { unbind(); unbind = null; }
      root.removeAttribute('data-dragging');
      try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
      if (!g.moved) { commit(target, true); return; }
      var stale = performance.now() - g.hist[g.hist.length - 1][0] > STALE_MS;
      var v = e.type === 'pointercancel' || stale ? 0 : velocityOf(g.hist);
      var bounce = P.tapBounce + (P.flickBounce - P.tapBounce) * clamp(Math.abs(v) / range / V_FLICK, 0, 1);
      var to = snap((g.at != null ? g.at : target) + (v / 1000) * (DECEL / (1 - DECEL)) * P.momentum);
      commit(to, true, { velocity: v, bounce: bounce });
      launch(to, bounce, v);
    }
    function down(e) {
      if (inert || grip || e.button > 0) return;
      var p = localPoint(e.clientX, e.clientY);
      if (Math.hypot(p[0], p[1]) < DEAD) return;
      e.preventDefault();
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      svg.focus({ preventScroll: true });
      grip = { id: e.pointerId, at: null, hist: [], side: null, moved: false, x0: e.clientX, y0: e.clientY };
      var at = angleAt(e.clientX, e.clientY);
      grip.hist.push([performance.now(), at]);
      root.setAttribute('data-dragging', '');
      commit(at, false);
      launch(snap(at), P.tapBounce);
      var onMove = function (ev) { if (ev.isTrusted) move(ev); };
      var onUp = function (ev) { if (ev.isTrusted) up(ev); };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      unbind = function () {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
    }
    function key(e) {
      if (inert) return;
      var t = target, big = e.shiftKey ? 10 : 1, to;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowUp': to = t + P.step * big; break;
        case 'ArrowLeft': case 'ArrowDown': to = t - P.step * big; break;
        case 'PageUp': to = t + P.step * 10; break;
        case 'PageDown': to = t - P.step * 10; break;
        case 'Home': to = P.min; break;
        case 'End': to = P.max; break;
        default: return;
      }
      e.preventDefault();
      to = snap(to);
      reading.stop();
      reading.jump(to);
      commit(to, true);
      wake();
    }
    if (!inert) {
      svg.addEventListener('pointerdown', down);
      svg.addEventListener('keydown', key);
    }

    // first paint (the original does this in a layout effect)
    paint(performance.now());

    return {
      setValue: function (v) {
        if (grip) return;
        var s = snap(v);
        if (s === target) return;
        target = s;
        launch(s, P.tapBounce);
      },
      replay: function () {
        reading.jump(P.min);
        L.rPrev = null;
        launch(target, P.tapBounce);
      },
      update: function (next) {
        var keep = target;
        this.destroy();
        var inst = CometDial(host, Object.assign({}, P, next || {}, { value: undefined, defaultValue: keep }));
        var self = this;
        ['setValue', 'replay', 'update', 'destroy'].forEach(function (m) { self[m] = inst[m]; });
        Object.defineProperty(self, 'value', { get: function () { return inst.value; }, configurable: true });
        Object.defineProperty(self, 'element', { get: function () { return inst.element; }, configurable: true });
      },
      destroy: function () {
        destroyed = true;
        cancelAnimationFrame(L.raf);
        if (unbind) { unbind(); unbind = null; }
        reading.stop();
        host.textContent = '';
      },
      get value() { return target; },
      get element() { return root; }
    };
  }

  window.CometDial = CometDial;
})();
