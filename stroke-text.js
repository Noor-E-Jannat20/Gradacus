/*
 * StrokeText — vanilla JS port of the React Bits <StrokeText /> component
 * (JavaScript + CSS variant). Same props, same measuring logic, same GSAP timeline.
 * Requires gsap (and optionally gsap/ScrollTrigger for trigger: 'scroll').
 * If GSAP failed to load, the wordmark renders statically (filled, no animation).
 *
 * Usage:
 *   const st = StrokeText(document.getElementById('host'), { text: 'Draw Attention', trigger: 'mount' });
 *   st.update({ text: 'New text' });   // re-render with changed props
 *   st.destroy();
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var uidCounter = 0;

  var DEFAULTS = {
    text: 'Draw Attention',
    strokeColor: '#A78BFA',
    fillColor: '#F8FAFC',
    strokeWidth: 1.4,
    drawDuration: 1.6,
    fillDelay: 0.2,
    stagger: 0.05,
    ease: 'power2.out',
    trigger: 'mount',      // 'mount' | 'hover' | 'scroll' | 'loop'
    fillMode: 'wipe',      // 'fade' | 'wipe' | 'none'
    fontSize: 128,
    fontWeight: 800,
    letterSpacing: -4,
    reverse: false,
    className: '',
    style: {}
  };

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function StrokeText(host, userProps) {
    var props = Object.assign({}, DEFAULTS, userProps || {});
    var gsap = window.gsap;
    if (gsap && window.ScrollTrigger && !StrokeText._registered) {
      gsap.registerPlugin(window.ScrollTrigger);
      StrokeText._registered = true;
    }

    var wipeId = 'stroke-text-wipe-' + (++uidCounter);
    var root, svg, strokeText, fillText, wipeRect, clipPath;
    var box = null;
    var cancelled = false;
    var cleanupAnim = null;

    function characters() { return Array.from(String(props.text == null ? '' : props.text)); }

    function fontStyle(el) {
      el.style.fontSize = props.fontSize + 'px';
      el.style.fontWeight = props.fontWeight;
      el.style.letterSpacing = props.letterSpacing + 'px';
    }

    function render() {
      host.textContent = '';
      var chars = characters();

      root = document.createElement('span');
      root.className = ('stroke-text ' + (props.trigger === 'hover' ? 'stroke-text--hover ' : '') + (props.className || '')).trim();
      Object.keys(props.style || {}).forEach(function (k) { root.style[k] = props.style[k]; });
      root.style.setProperty('--stroke-text-height', Math.round(props.fontSize * 1.3) + 'px');
      root.setAttribute('role', 'img');
      root.setAttribute('aria-label', String(props.text == null ? '' : props.text));

      svg = svgEl('svg', {
        class: 'stroke-text__svg',
        viewBox: '0 ' + (-props.fontSize) + ' 600 ' + (props.fontSize * 1.3),
        preserveAspectRatio: 'xMidYMid meet',
        'aria-hidden': 'true'
      });

      if (props.fillMode === 'wipe') {
        var defs = svgEl('defs');
        clipPath = svgEl('clipPath', { id: wipeId, clipPathUnits: 'userSpaceOnUse' });
        wipeRect = svgEl('rect', { x: 0, y: 0, width: 0, height: 0 });
        clipPath.appendChild(wipeRect);
        defs.appendChild(clipPath);
        svg.appendChild(defs);
      } else {
        clipPath = null; wipeRect = null;
      }

      strokeText = svgEl('text', {
        class: 'stroke-text__stroke', x: 0, y: 0, fill: 'none',
        stroke: props.strokeColor, 'stroke-width': props.strokeWidth,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      });
      fontStyle(strokeText);
      chars.forEach(function (c) {
        var t = svgEl('tspan'); t.setAttribute('data-stroke-char', ''); t.textContent = c; strokeText.appendChild(t);
      });

      fillText = svgEl('text', {
        class: 'stroke-text__fill', x: 0, y: 0, fill: props.fillColor, stroke: 'none'
      });
      fontStyle(fillText);
      chars.forEach(function (c) {
        var t = svgEl('tspan'); t.setAttribute('data-fill-char', ''); t.textContent = c; fillText.appendChild(t);
      });

      svg.appendChild(strokeText);
      svg.appendChild(fillText);
      root.appendChild(svg);
      host.appendChild(root);
    }

    function measure() {
      if (cancelled || !strokeText) return;
      var bbox;
      try { bbox = strokeText.getBBox(); } catch (e) { return; }
      if (!bbox || !bbox.width) return;

      var pad = Math.max(Number(props.strokeWidth) || 1, props.fontSize * 0.1);
      var next = { x: bbox.x - pad, y: bbox.y - pad, width: bbox.width + pad * 2, height: bbox.height + pad * 2 };

      if (box && Math.abs(box.x - next.x) < 0.5 && Math.abs(box.width - next.width) < 0.5 && Math.abs(box.y - next.y) < 0.5) return;
      box = next;

      svg.setAttribute('viewBox', box.x + ' ' + box.y + ' ' + box.width + ' ' + box.height);
      if (wipeRect) {
        wipeRect.setAttribute('x', box.x);
        wipeRect.setAttribute('y', box.y);
        wipeRect.setAttribute('height', box.height);
        fillText.setAttribute('clip-path', 'url(#' + wipeId + ')');
      }
      animate();
    }

    function animate() {
      if (cleanupAnim) { cleanupAnim(); cleanupAnim = null; }
      if (!box) return;

      var strokes = Array.prototype.slice.call(root.querySelectorAll('[data-stroke-char]'));
      var fills = Array.prototype.slice.call(root.querySelectorAll('[data-fill-char]'));
      if (!strokes.length) return;

      // No GSAP (offline / blocked CDN): show the finished wordmark, no animation.
      if (!gsap) {
        fills.forEach(function (f) { f.style.opacity = props.fillMode === 'none' ? 0 : 1; });
        if (wipeRect) wipeRect.setAttribute('width', box.width);
        strokes.forEach(function (s) { s.style.strokeDasharray = 'none'; });
        return;
      }

      var wipe = wipeRect;
      var dash = Math.max(props.fontSize * 7, 200);
      var fillEnabled = props.fillMode !== 'none';
      var useWipe = fillEnabled && props.fillMode === 'wipe';
      var fillDuration = Math.max(0.4, props.drawDuration * 0.5);
      var staggerConfig = props.reverse ? { each: props.stagger, from: 'end' } : props.stagger;
      var targets = strokes.concat(fills).concat(wipe ? [wipe] : []);

      function setStart() {
        gsap.killTweensOf(targets);
        gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: dash });
        gsap.set(fills, { opacity: useWipe ? 1 : 0 });
        if (wipe) gsap.set(wipe, { attr: { width: 0 } });
      }
      function setEnd() {
        gsap.killTweensOf(targets);
        gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: 0 });
        gsap.set(fills, { opacity: fillEnabled ? 1 : 0 });
        if (wipe) gsap.set(wipe, { attr: { width: fillEnabled ? box.width : 0 } });
      }

      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        setEnd();
        cleanupAnim = function () { gsap.killTweensOf(targets); };
        return;
      }

      function build() {
        setStart();
        var tl = gsap.timeline({
          paused: true,
          repeat: props.trigger === 'loop' ? -1 : 0,
          repeatDelay: props.trigger === 'loop' ? 0.9 : 0,
          defaults: { overwrite: 'auto' }
        });
        tl.to(strokes, { strokeDashoffset: 0, duration: props.drawDuration, ease: props.ease, stagger: staggerConfig }, 0);
        if (useWipe && wipe) {
          tl.to(wipe, { attr: { width: box.width }, duration: fillDuration, ease: 'power2.inOut' }, props.drawDuration + props.fillDelay);
        } else if (fillEnabled) {
          tl.to(fills, { opacity: 1, duration: fillDuration, ease: 'power2.out', stagger: staggerConfig }, props.drawDuration + props.fillDelay);
        }
        return tl;
      }

      var timeline = null, scrollTrigger = null, removeHover = null;

      if (props.trigger === 'hover') {
        setEnd();
        var play = function () { if (timeline) timeline.kill(); timeline = build(); timeline.play(0); };
        root.addEventListener('pointerenter', play);
        removeHover = function () { root.removeEventListener('pointerenter', play); };
      } else {
        timeline = build();
        if (props.trigger === 'scroll' && window.ScrollTrigger) {
          scrollTrigger = window.ScrollTrigger.create({
            trigger: root, start: 'top 82%', once: true,
            onEnter: function () { if (timeline) timeline.play(0); }
          });
        } else {
          timeline.play(0);
        }
      }

      cleanupAnim = function () {
        if (removeHover) removeHover();
        if (scrollTrigger) scrollTrigger.kill();
        if (timeline) timeline.kill();
        gsap.killTweensOf(targets);
      };
    }

    function mount() {
      cancelled = false;
      box = null;
      render();
      measure();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(measure).catch(function () {});
      }
    }

    function destroy() {
      cancelled = true;
      if (cleanupAnim) { cleanupAnim(); cleanupAnim = null; }
      host.textContent = '';
    }

    mount();

    return {
      destroy: destroy,
      update: function (next) { destroy(); props = Object.assign({}, props, next || {}); mount(); },
      replay: function () { animate(); },
      get element() { return root; }
    };
  }

  window.StrokeText = StrokeText;
})();
