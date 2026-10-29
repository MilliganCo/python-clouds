/* Decorative 3D clouds. One WebGL context; all controls remain native HTML. */
window.CloudModels = (() => {
  const canvas = document.createElement("canvas");
  canvas.className = "cloud-models";
  canvas.setAttribute("aria-hidden", "true");
  const viewport = document.createElement("div");
  viewport.className = "cloud-model-viewport";
  viewport.append(canvas);
  let gl, program, buffer, meshes, uniforms, scene, nodes = [], frame = 0, observer, visibility;
  let width = 1, height = 1, visible = false, moving = false, time = 0, previous = 0;
  let padding = 0, viewWidth = 1, viewHeight = 1;
  let pointer = [0, 0], target = [0, 0], lost = false;
  const vertex = `
    attribute vec3 position, surfaceNormal;
    uniform mediump vec2 viewport;
    uniform vec2 anchor;
    uniform mat3 rotation;
    uniform float scale, press, layer;
    uniform vec3 shape;
    varying vec3 normal, local;
    varying vec2 screenPoint;
    void main() {
      vec3 stretch = shape * vec3(1.0 + press * .09, 1.0 - press * .18, 1.0);
      local = position * stretch;
      vec3 p = rotation * local;
      normal = rotation * (surfaceNormal / stretch);
      float perspective = 1.0 + p.z * .12;
      vec2 pixel = anchor + vec2(p.x, -p.y) * scale * perspective;
      screenPoint = pixel;
      gl_Position = vec4(pixel.x / viewport.x * 2.0 - 1.0,
                         1.0 - pixel.y / viewport.y * 2.0, layer - p.z * .035, 1.0);
    }`;
  const fragment = `
    precision mediump float;
    varying vec3 normal, local;
    varying vec2 screenPoint;
    uniform vec3 tint;
    uniform mediump vec2 viewport;
    uniform float haze, opacity;
    void main() {
      float edge = min(min(screenPoint.x, viewport.x - screenPoint.x),
                       min(screenPoint.y, viewport.y - screenPoint.y));
      float alpha = opacity < 1.0 ? opacity * smoothstep(0.0, 80.0, edge) : 1.0;
      vec3 n = normalize(normal);
      vec3 light = normalize(vec3(-.6, .9, 1.2));
      float diffuse = max(dot(n, light), 0.0);
      float sky = smoothstep(-.65, .6, n.y);
      vec3 shade = mix(vec3(.34, .49, .67), tint, .35 + .65 * diffuse);
      shade += vec3(.06, .08, .10) * sky;
      shade += vec3(.07, .08, .09) * pow(max(dot(n, normalize(light + vec3(0,0,1))), 0.0), 12.0);
      shade *= .88 + .12 * smoothstep(-.5, .4, local.y);
      gl_FragColor = vec4(mix(shade, vec3(.13, .24, .34), haze), alpha);
    }`;

  function init() {
    if (program || lost) return !!program && !lost;
    try {
      gl = canvas.getContext("webgl", { alpha: true, antialias: true, powerPreference: "low-power" });
      if (!gl) return false;
      program = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
      }
      gl.bindAttribLocation(program, 0, "position");
      gl.bindAttribLocation(program, 1, "surfaceNormal");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("cloud shader unavailable");
      gl.useProgram(program);
      // Bake smooth unions once, not a costly ray marcher on every animation frame.
      const vertices = [];
      meshes = Array.from({ length: 9 }, (_, seed) => {
        const start = vertices.length / 6;
        const mesh = cloudMesh(puffs(seed));
        for (const value of mesh) vertices.push(value);
        return { start, count: mesh.length / 6 };
      });
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      if (gl.getError() !== gl.NO_ERROR) throw new Error("cloud buffer unavailable");
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      uniforms = Object.fromEntries(["viewport", "anchor", "rotation", "scale", "tint", "press", "shape", "haze", "layer", "opacity"]
        .map(name => [name, gl.getUniformLocation(program, name)]));
      gl.enable(gl.DEPTH_TEST);
      return true;
    } catch (_) {
      if (buffer) gl?.deleteBuffer(buffer);
      if (program) gl?.deleteProgram(program);
      program = null;
      return false; // Raster fallback still has working buttons, labels and descriptions.
    }
  }

  // Asymmetric silhouettes: a tall cumulus, a long bank, and smaller clusters.
  function puffs(seed) {
    const tall = seed % 3 === 0, wide = seed % 3 === 1;
    const flip = seed % 2 ? -1 : 1;
    const parts = [
      [-.64 * flip, -.08, -.12, .46, .38, .44],
      [.58 * flip, -.1, -.1, wide ? .59 : .46, .35, .42],
      [-.16 * flip, .24, -.14, .58, tall ? .69 : .52, .51],
      [.38 * flip, .23, -.14, .44, .46, .44],
      [-.35 * flip, -.18, .25, .5, .32, .43],
      [.22 * flip, -.14, .29, .53, .37, .43],
      [-.8 * flip, -.19, .06, .29, .25, .28],
      [.76 * flip, -.17, .12, .31, .28, .3],
      [.05, -.33, .03, .72, .22, .43],
    ];
    if (seed === 3) { // A rising, split crown rather than another mirrored bank.
      parts[2] = [-.36, .3, -.1, .43, .57, .43];
      parts[3] = [.3, .22, -.15, .4, .43, .4];
      parts[5] = [.35, -.08, .34, .35, .3, .39];
    }
    if (seed === 4) {
      parts[2] = [-.25, .12, -.2, .38, .36, .42];
      parts[3] = [.36, .4, -.14, .47, .61, .46];
      parts[4] = [-.48, -.2, .24, .58, .25, .35];
    }
    if (seed === 5) { // Low, layered bank with a small raised tail.
      parts[2] = [-.3, .08, -.14, .7, .35, .48];
      parts[3] = [.58, .22, -.1, .3, .37, .32];
      parts[5] = [.36, -.12, .32, .64, .27, .37];
    }
    if (seed === 6) { // Compact crown: noticeably taller than the banks.
      parts[2] = [-.08, .38, -.12, .44, .72, .45];
      parts[3] = [.36, .12, -.12, .36, .4, .38];
      parts[0] = [-.5, -.08, -.1, .38, .34, .4];
    }
    if (seed === 7) { // Three uneven rounded peaks.
      parts[2] = [-.45, .3, -.1, .36, .5, .4];
      parts[3] = [.38, .34, -.08, .37, .55, .4];
      parts.push([.02, .42, -.13, .29, .46, .37]);
    }
    if (seed === 8) { // Asymmetric sweep, with a full front and a tapered side.
      parts[0] = [-.67, -.12, -.1, .55, .28, .4];
      parts[2] = [-.1, .14, -.18, .62, .43, .5];
      parts[3] = [.48, .26, -.08, .32, .55, .37];
      parts[6] = [-.96, -.18, .02, .24, .18, .23];
    }
    return parts;
  }

  function cloudMesh(parts) {
    const distance = (x, y, z) => {
      let d = 10;
      for (const [px, py, pz, rx, ry, rz] of parts) {
        const sphere = (Math.hypot((x - px) / rx, (y - py) / ry, (z - pz) / rz) - 1) * Math.min(rx, ry, rz);
        const h = Math.max(.1 - Math.abs(d - sphere), 0) / .1;
        d = Math.min(d, sphere) - h * h * .025;
      }
      return d;
    };
    // Bound the actual puffs plus the smooth union, rather than slicing a new
    // silhouette at the edge of a fixed marching-tetrahedra grid.
    const mesh = [], step = .09;
    const low = [0, 1, 2].map(axis => Math.min(...parts.map(p => p[axis] - p[axis + 3])) - .15);
    const high = [0, 1, 2].map(axis => Math.max(...parts.map(p => p[axis] + p[axis + 3])) + .15);
    const [nx, ny, nz] = high.map((value, axis) => Math.ceil((value - low[axis]) / step));
    const grid = [];
    for (let z = 0; z <= nz; z++) for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      const p = [x * step + low[0], y * step + low[1], z * step + low[2]];
      grid.push({ p, d: distance(...p) });
    }
    const at = (x, y, z) => grid[(z * (ny + 1) + y) * (nx + 1) + x];
    const emit = p => {
      const e = .003, [x, y, z] = p;
      const n = [distance(x + e, y, z) - distance(x - e, y, z),
        distance(x, y + e, z) - distance(x, y - e, z), distance(x, y, z + e) - distance(x, y, z - e)];
      const length = Math.hypot(...n) || 1;
      mesh.push(...p, ...n.map(v => v / length));
    };
    const crossing = (a, b) => a.p.map((v, i) => v + (b.p[i] - v) * a.d / (a.d - b.d));
    const tetrahedra = [[0,5,1,6], [0,1,2,6], [0,2,3,6], [0,3,7,6], [0,7,4,6], [0,4,5,6]];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const cube = [at(x,y,z), at(x+1,y,z), at(x+1,y+1,z), at(x,y+1,z),
        at(x,y,z+1), at(x+1,y,z+1), at(x+1,y+1,z+1), at(x,y+1,z+1)];
      if (cube.every(v => v.d >= 0) || cube.every(v => v.d < 0)) continue;
      for (const tetra of tetrahedra) {
        const inside = tetra.map(i => cube[i]).filter(v => v.d < 0);
        const outside = tetra.map(i => cube[i]).filter(v => v.d >= 0);
        if (!inside.length || !outside.length) continue;
        if (inside.length === 2) {
          const a = crossing(inside[0], outside[0]), b = crossing(inside[0], outside[1]);
          const c = crossing(inside[1], outside[0]), d = crossing(inside[1], outside[1]);
          [a, b, c, b, d, c].forEach(emit);
        } else {
          const one = inside.length === 1 ? inside : outside;
          const three = inside.length === 1 ? outside : inside;
          three.forEach(v => emit(crossing(one[0], v)));
        }
      }
    }
    return mesh;
  }

  function resize() {
    if (!scene) return;
    viewWidth = document.documentElement.clientWidth;
    viewHeight = scene.clientHeight;
    // The layout frame stays put while the scene scales during a topic flight.
    const offset = scene.parentElement.getBoundingClientRect().left;
    nodes.forEach(node => {
      node.size = Math.min(node.stop.clientWidth * .42 * Number(node.stop.style.getPropertyValue("--cloud-size")), Math.min(offset + node.stop.offsetLeft, viewWidth - offset - node.stop.offsetLeft) * .7);
    });
    padding = Math.ceil(Math.max(128, ...nodes.map(node => node.size * 1.8)));
    width = viewWidth + padding * 2;
    height = viewHeight + padding * 2;
    // Only the physical window edge clips horizontally. The drawing buffer has
    // room for the whole rotated mesh, including above/below the route itself.
    viewport.style.cssText = `left:${-offset}px;top:${-padding}px;width:${viewWidth}px;height:${height}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${-padding}px`;
    // ponytail: cap resolution for this decorative scene; no postprocessing or texture buffers.
    const ratio = Math.min(devicePixelRatio || 1, width < 640 ? 1.25 : 1.5, 2048 / height, 4096 / width);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    nodes.forEach(node => {
      node.x = padding + offset + node.stop.offsetLeft;
      node.y = padding + node.stop.offsetTop - 7;
    });
    wake();
  }
  function wake() {
    if (!frame && scene && visible && !document.hidden && !lost) frame = requestAnimationFrame(draw);
  }
  function draw(now) {
    frame = 0;
    if (!scene?.isConnected || !visible || document.hidden || lost) return;
    const dt = Math.min((now - (previous || now)) / 1000, .035);
    previous = now;
    if (moving) time += dt;
    const follow = moving ? 1 - Math.exp(-dt * 8) : 1;
    pointer = pointer.map((v, i) => v + ((moving ? target[i] : 0) - v) * follow);
    const focused = nodes.find(node => node.stop.matches(".peek-open, .detail-open, .cloud-landmark:hover, .cloud-landmark:focus-within"));
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform2f(uniforms.viewport, width, height);
    // Same lit geometry at three distant planes, with atmospheric perspective.
    gl.uniform1f(uniforms.press, 0);
    gl.uniform3fv(uniforms.tint, [.72, .83, .94]);
    const banks = [[.25,.48,.9], [.09,.08,.8], [.9,.7,.65], [.75,.25,.55], [.1,.87,.4]];
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    banks.forEach(([x, y, distance], i) => {
      const mesh = meshes[(i + 1) % meshes.length];
      const angle = Math.sin(time * .12 + i) * .14;
      const c = Math.cos(angle), s = Math.sin(angle);
      gl.uniformMatrix3fv(uniforms.rotation, false, [c, 0, -s, 0, 1, 0, s, 0, c]);
      gl.uniform3fv(uniforms.shape, [1.3, .8 + i % 2 * .25, 1]);
      gl.uniform1f(uniforms.layer, .65 + distance * .2);
      gl.uniform1f(uniforms.haze, .48 + distance * .18);
      gl.uniform1f(uniforms.opacity, .10 + (1 - distance) * .08);
      gl.uniform1f(uniforms.scale, Math.min(viewWidth * .24, 220) * (1.25 - distance * .5));
      gl.uniform2f(uniforms.anchor,
        padding + x * viewWidth - pointer[0] * (1 - distance) * 70,
        padding + y * viewHeight - pointer[1] * (1 - distance) * 35 + Math.sin(time * .2 + i) * (moving ? 5 : 0));
      // Depth first: transparent back faces must not accumulate into an opaque blob.
      gl.colorMask(false, false, false, false);
      gl.drawArrays(gl.TRIANGLES, mesh.start, mesh.count);
      gl.colorMask(true, true, true, true);
      gl.depthFunc(gl.EQUAL);
      gl.drawArrays(gl.TRIANGLES, mesh.start, mesh.count);
      gl.depthFunc(gl.LESS);
    });
    gl.disable(gl.BLEND);
    gl.uniform1f(uniforms.opacity, 1);
    nodes.forEach((node, i) => {
      const active = moving && node === focused ? 1 : 0;
      const pressed = moving && node.stop.classList.contains("cloud-pressed") ? 1 : 0;
      node.velocity += ((active - node.lift) * 95 - node.velocity * 12) * dt;
      node.lift += node.velocity * dt;
      if (!moving) node.lift = node.velocity = node.press = 0;
      node.press += (pressed - node.press) * follow;
      const phase = time * .65 + i * 1.8;
      const bob = moving ? Math.sin(phase) * (3 + i % 3) : 0;
      const rx = -.16 + pointer[1] * .09 + node.lift * node.aim[1] * .23;
      const ry = Math.sin(i * 2.3) * .18 + (moving ? Math.sin(phase * .6) * .055 : 0)
        + pointer[0] * .12 + node.lift * (node.aim[0] * .4 + .13);
      const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
      gl.uniformMatrix3fv(uniforms.rotation, false, [cy * node.flip, sx * sy * node.flip, -cx * sy * node.flip,
        0, cx, sx, sy, -sx * cy, cx * cy]);
      const depth = node.depth;
      const dx = pointer[0] * depth * 22;
      const dy = bob + pointer[1] * depth * 12 - node.lift * 20 + node.press * 9;
      gl.uniform2f(uniforms.anchor, node.x + dx, node.y + dy);
      gl.uniform1f(uniforms.scale, node.size * (.91 + depth * .14) * (1 + node.lift * .16));
      gl.uniform1f(uniforms.press, node.press);
      gl.uniform3fv(uniforms.shape, node.shape);
      gl.uniform1f(uniforms.layer, -.15 - depth * .4 - node.lift * .1);
      gl.uniform1f(uniforms.haze, (1 - depth) * .13 * (1 - node.lift));
      gl.uniform3fv(uniforms.tint, node.tint);
      gl.drawArrays(gl.TRIANGLES, node.mesh.start, node.mesh.count);
      // Labels follow their own model; the hit target itself stays stable.
      node.stop.style.setProperty("--model-x", `${dx.toFixed(2)}px`);
      node.stop.style.setProperty("--model-y", `${dy.toFixed(2)}px`);
    });
    if (moving) wake();
  }

  function detach() {
    cancelAnimationFrame(frame);
    frame = previous = 0;
    observer?.disconnect();
    visibility?.disconnect();
    window.removeEventListener("resize", resize);
    scene?.classList.remove("has-cloud-models");
    viewport.remove();
    scene = null;
    nodes = [];
  }
  function attach(nextScene, seed, enabled) {
    detach();
    if (!init()) return;
    scene = nextScene;
    scene.append(viewport);
    scene.classList.add("has-cloud-models");
    moving = enabled;
    visible = true;
    pointer = target = [0, 0];
    nodes = Array.from(scene.querySelectorAll(".cloud-stop, .cloud-landmark"), (stop, i) => ({
      stop, mesh: meshes[stop.classList.contains("cloud-landmark") ? 1 : (seed + i) % meshes.length], flip: (seed + i) % 2 ? 1 : -1,
      tint: stop.dataset.cloudTint.split(" ").map(Number),
      depth: Number(stop.style.getPropertyValue("--depth")),
      shape: stop.classList.contains("cloud-theory") ? [1.18,.95,1] : stop.classList.contains("cloud-landmark") ? [1.18,.73,.85] : [[1,.95,1], [1.08,.83,.9], [.92,1.08,1.1], [1.04,1,.85]][(seed + i) % 4],
      lift: 0, velocity: 0, press: 0, aim: [0, 0],
    }));
    nodes.forEach(node => {
      const button = node.stop.querySelector("button, a");
      button.addEventListener("pointermove", event => {
        if (event.pointerType !== "mouse") return;
        const box = button.getBoundingClientRect();
        node.aim = [(event.clientX - box.left) / box.width * 2 - 1, (event.clientY - box.top) / box.height * 2 - 1]
          .map(value => Math.max(-1, Math.min(1, value)));
      });
    });
    observer = new ResizeObserver(resize);
    observer.observe(scene);
    window.addEventListener("resize", resize);
    visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) { cancelAnimationFrame(frame); frame = previous = 0; }
      else wake();
    });
    visibility.observe(scene);
    resize();
  }
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    lost = true;
    program = null;
    cancelAnimationFrame(frame);
    frame = 0;
    scene?.classList.remove("has-cloud-models");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    if (scene && init()) { scene.classList.add("has-cloud-models"); resize(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = previous = 0; }
    else wake();
  });
  return { attach, detach,
    motion(enabled) { moving = enabled; wake(); },
    pan(x, y) { target = [x, y]; },
  };
})();
