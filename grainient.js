/*
 * Grainient — vanilla JS port of the React Bits <Grainient /> component
 * (JavaScript + CSS variant). Same props, same fragment shader. The `ogl`
 * dependency is replaced by a few lines of raw WebGL2 (one full-screen triangle).
 *
 * Like the original: one WebGL context for the lifetime of the instance,
 * props update uniforms only, and rendering pauses while the element is
 * off-screen or the tab is hidden. If WebGL2 isn't available the container
 * stays empty (give it a CSS background as the fallback).
 *
 * Extra prop: `static` – render a single frame and never animate
 * (used automatically when the user prefers reduced motion).
 *
 * Usage:
 *   const g = Grainient(containerEl, { color1: '#10093a', color2: '#5046e4', color3: '#030014' });
 *   g.update({ timeSpeed: 0.1 });
 *   g.destroy();
 */
(function () {
  'use strict';

  var DEFAULTS = {
    timeSpeed: 0.25, colorBalance: 0.0, warpStrength: 1.0, warpFrequency: 5.0, warpSpeed: 2.0,
    warpAmplitude: 50.0, blendAngle: 0.0, blendSoftness: 0.05, rotationAmount: 500.0, noiseScale: 2.0,
    grainAmount: 0.1, grainScale: 2.0, grainAnimated: false, contrast: 1.5, gamma: 1.0, saturation: 1.0,
    centerX: 0.0, centerY: 0.0, zoom: 0.9,
    color1: '#FF9FFC', color2: '#5227FF', color3: '#B497CF',
    lightMode: false, className: '', static: false
  };

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return [1, 1, 1];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }

  var VERTEX = '#version 300 es\n' +
    'in vec2 position;\n' +
    'void main() {\n  gl_Position = vec4(position, 0.0, 1.0);\n}\n';

  var FRAGMENT = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform vec2 iResolution;\n' +
    'uniform float iTime;\n' +
    'uniform float uTimeSpeed;\n' +
    'uniform float uColorBalance;\n' +
    'uniform float uWarpStrength;\n' +
    'uniform float uWarpFrequency;\n' +
    'uniform float uWarpSpeed;\n' +
    'uniform float uWarpAmplitude;\n' +
    'uniform float uBlendAngle;\n' +
    'uniform float uBlendSoftness;\n' +
    'uniform float uRotationAmount;\n' +
    'uniform float uNoiseScale;\n' +
    'uniform float uGrainAmount;\n' +
    'uniform float uGrainScale;\n' +
    'uniform float uGrainAnimated;\n' +
    'uniform float uContrast;\n' +
    'uniform float uGamma;\n' +
    'uniform float uSaturation;\n' +
    'uniform vec2 uCenterOffset;\n' +
    'uniform float uZoom;\n' +
    'uniform vec3 uColor1;\n' +
    'uniform vec3 uColor2;\n' +
    'uniform vec3 uColor3;\n' +
    'uniform float uLightMode;\n' +
    'out vec4 fragColor;\n' +
    '#define S(a,b,t) smoothstep(a,b,t)\n' +
    'mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}\n' +
    'vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}\n' +
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}\n' +
    'void mainImage(out vec4 o, vec2 C){\n' +
    '  float t=iTime*uTimeSpeed;\n' +
    '  vec2 uv=C/iResolution.xy;\n' +
    '  float ratio=iResolution.x/iResolution.y;\n' +
    '  vec2 tuv=uv-0.5+uCenterOffset;\n' +
    '  tuv/=max(uZoom,0.001);\n' +
    '  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);\n' +
    '  tuv.y*=1.0/ratio;\n' +
    '  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));\n' +
    '  tuv.y*=ratio;\n' +
    '  float frequency=uWarpFrequency;\n' +
    '  float ws=max(uWarpStrength,0.001);\n' +
    '  float amplitude=uWarpAmplitude/ws;\n' +
    '  float warpTime=t*uWarpSpeed;\n' +
    '  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;\n' +
    '  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);\n' +
    '  vec3 colLav=uColor1;\n' +
    '  vec3 colOrg=uColor2;\n' +
    '  vec3 colDark=uColor3;\n' +
    '  float b=uColorBalance;\n' +
    '  float s=max(uBlendSoftness,0.0);\n' +
    '  mat2 blendRot=Rot(radians(uBlendAngle));\n' +
    '  float blendX=(tuv*blendRot).x;\n' +
    '  float edge0=-0.3-b-s;\n' +
    '  float edge1=0.2-b+s;\n' +
    '  float v0=0.5-b+s;\n' +
    '  float v1=-0.3-b-s;\n' +
    '  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));\n' +
    '  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));\n' +
    '  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));\n' +
    '  vec2 grainUv=uv*max(uGrainScale,0.001);\n' +
    '  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);}\n' +
    '  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);\n' +
    '  col+=(grain-0.5)*uGrainAmount;\n' +
    '  col=(col-0.5)*uContrast+0.5;\n' +
    '  float luma=dot(col,vec3(0.2126,0.7152,0.0722));\n' +
    '  col=mix(vec3(luma),col,uSaturation);\n' +
    '  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));\n' +
    '  col=clamp(col,0.0,1.0);\n' +
    '  if(uLightMode>0.5){\n' +
    '    float energy=max(max(col.r,col.g),col.b);\n' +
    '    vec3 hue=col/max(energy,0.001);\n' +
    '    float chroma=length(col-vec3(dot(col,vec3(0.333333))));\n' +
    '    float coverage=clamp(0.12+chroma*1.15+energy*0.18,0.0,0.88);\n' +
    '    col=mix(vec3(1.0),clamp(hue*0.58+col*0.18,0.0,1.0),coverage);\n' +
    '  }\n' +
    '  o=vec4(col,1.0);\n' +
    '}\n' +
    'void main(){\n  vec4 o=vec4(0.0);\n  mainImage(o,gl_FragCoord.xy);\n  fragColor=o;\n}\n';

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Grainient shader error: ' + log);
    }
    return sh;
  }

  function Grainient(container, userProps) {
    var P = Object.assign({}, DEFAULTS, userProps || {});
    container.classList.add('grainient-container');
    if (P.className) P.className.split(/\s+/).forEach(function (c) { if (c) container.classList.add(c); });

    var canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.setAttribute('aria-hidden', 'true');

    var gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true });
    if (!gl) return { update: function () {}, destroy: function () {}, supported: false };

    var program, vbo, vao, uni = {};
    try {
      var vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
      var fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.bindAttribLocation(program, 0, 'position');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    } catch (err) {
      console.warn(err);
      return { update: function () {}, destroy: function () {}, supported: false };
    }
    container.appendChild(canvas);

    // single full-screen triangle (what ogl's Triangle geometry is)
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(program);
    ['iResolution', 'iTime', 'uTimeSpeed', 'uColorBalance', 'uWarpStrength', 'uWarpFrequency', 'uWarpSpeed',
      'uWarpAmplitude', 'uBlendAngle', 'uBlendSoftness', 'uRotationAmount', 'uNoiseScale', 'uGrainAmount',
      'uGrainScale', 'uGrainAnimated', 'uContrast', 'uGamma', 'uSaturation', 'uCenterOffset', 'uZoom',
      'uColor1', 'uColor2', 'uColor3', 'uLightMode'].forEach(function (n) { uni[n] = gl.getUniformLocation(program, n); });

    function applyProps() {
      gl.useProgram(program);
      gl.uniform1f(uni.uTimeSpeed, P.timeSpeed);
      gl.uniform1f(uni.uColorBalance, P.colorBalance);
      gl.uniform1f(uni.uWarpStrength, P.warpStrength);
      gl.uniform1f(uni.uWarpFrequency, P.warpFrequency);
      gl.uniform1f(uni.uWarpSpeed, P.warpSpeed);
      gl.uniform1f(uni.uWarpAmplitude, P.warpAmplitude);
      gl.uniform1f(uni.uBlendAngle, P.blendAngle);
      gl.uniform1f(uni.uBlendSoftness, P.blendSoftness);
      gl.uniform1f(uni.uRotationAmount, P.rotationAmount);
      gl.uniform1f(uni.uNoiseScale, P.noiseScale);
      gl.uniform1f(uni.uGrainAmount, P.grainAmount);
      gl.uniform1f(uni.uGrainScale, P.grainScale);
      gl.uniform1f(uni.uGrainAnimated, P.grainAnimated ? 1.0 : 0.0);
      gl.uniform1f(uni.uContrast, P.contrast);
      gl.uniform1f(uni.uGamma, P.gamma);
      gl.uniform1f(uni.uSaturation, P.saturation);
      gl.uniform2f(uni.uCenterOffset, P.centerX, P.centerY);
      gl.uniform1f(uni.uZoom, P.zoom);
      gl.uniform3fv(uni.uColor1, hexToRgb(P.color1));
      gl.uniform3fv(uni.uColor2, hexToRgb(P.color2));
      gl.uniform3fv(uni.uColor3, hexToRgb(P.color3));
      gl.uniform1f(uni.uLightMode, P.lightMode ? 1.0 : 0.0);
    }

    var time = 0;
    function draw() {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform1f(uni.iTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    function setSize() {
      var rect = container.getBoundingClientRect();
      var w = Math.max(1, Math.floor(rect.width)), h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.useProgram(program);
      gl.uniform2f(uni.iResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
      draw();
    }

    applyProps();
    var ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var animate = !P.static && !reduce;
    var raf = 0, isVisible = true, isPageVisible = !document.hidden, t0 = performance.now(), destroyed = false;

    function loop(t) {
      time = (t - t0) * 0.001;
      draw();
      raf = requestAnimationFrame(loop);
    }
    function tryStart() { if (animate && isVisible && isPageVisible && raf === 0 && !destroyed) raf = requestAnimationFrame(loop); }
    function tryStop() { if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; } }

    var io = new IntersectionObserver(function (entries) {
      isVisible = entries[0].isIntersecting;
      if (isVisible) tryStart(); else tryStop();
    }, { threshold: 0 });
    io.observe(container);

    function onVisibility() {
      isPageVisible = !document.hidden;
      if (isPageVisible) tryStart(); else tryStop();
    }
    document.addEventListener('visibilitychange', onVisibility);
    tryStart();

    return {
      supported: true,
      update: function (next) {
        Object.assign(P, next || {});
        applyProps();
        if (!animate || raf === 0) draw();
      },
      destroy: function () {
        destroyed = true;
        tryStop();
        ro.disconnect();
        io.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        try { container.removeChild(canvas); } catch (e) { /* ignore */ }
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    };
  }

  window.Grainient = Grainient;
})();
