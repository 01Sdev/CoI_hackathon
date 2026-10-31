// 광각 렌더러. <video> 프레임을 캔버스 하나에 휘어 그린다. WebGL2를 먼저 쓰고, 없으면 CPU(긴 변 640) 경로.
// 이 캔버스는 원본 프레임을 담으므로 input/ 밖으로는 vision/에만 나간다(02-SSRD §1). 저장·업로드하지 않는다.
// shader는 pov-warp-lab.html 97~117행 그대로다(설계 docs/designs/input-wide-warp.md).

import { WIDE_WARP } from './config';
import { applyCpuMap, buildCpuMap, cpuSampleSize, warpOutputSize, warpParams, type CpuMap, type WarpSettings } from './warp';

export interface WarpRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly mode: 'gpu' | 'cpu';
  /** 지금 <video> 프레임을 휘어 그린다. 같은 task 안에서 canvas를 drawImage로 읽으면 이 프레임이다. 영상이 아직 없으면 false. */
  render(video: HTMLVideoElement): boolean;
}

const VERT = `#version 300 es
in vec2 position; out vec2 uv;
void main(){uv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 result;
uniform sampler2D source;
uniform float sourceAspect,outputAspect,strength,zoom,periphery;
uniform vec2 offset;
void main(){
  vec2 p=(uv*2.0-1.0)*vec2(outputAspect,1.0);
  if(periphery>0.0001){
    float angle=(p.x/outputAspect)*periphery;
    p.x=outputAspect*tan(angle)/tan(periphery);
    p.y*=periphery/(tan(periphery)*cos(angle));
  }
  float r2=dot(p,p)/(1.0+outputAspect*outputAspect);
  vec2 q=p*(1.0+strength*r2)/zoom;
  vec2 st=0.5+0.5*(q/vec2(sourceAspect,1.0)+offset);
  if(any(lessThan(st,vec2(0.0))) || any(greaterThan(st,vec2(1.0)))){
    result=vec4(0.0,0.0,0.0,1.0);return;
  }
  result=vec4(texture(source,st).rgb,1.0);
}`;

const settings = (): WarpSettings => ({ ...WIDE_WARP });

function resize(canvas: HTMLCanvasElement, video: HTMLVideoElement, maxLong: number): boolean {
  const { width, height } = warpOutputSize(video.videoWidth, video.videoHeight, maxLong);
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

function createGpu(canvas: HTMLCanvasElement): WarpRenderer | null {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) throw new Error('shader 생성 실패');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader 컴파일 실패');
    return sh;
  };
  const program = gl.createProgram();
  const vert = compile(gl.VERTEX_SHADER, VERT);
  const frag = compile(gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program 연결 실패');
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  gl.useProgram(program);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    source: u('source'),
    sourceAspect: u('sourceAspect'),
    outputAspect: u('outputAspect'),
    strength: u('strength'),
    zoom: u('zoom'),
    offset: u('offset'),
    periphery: u('periphery'),
  };
  gl.uniform1i(uniforms.source, 0);
  gl.clearColor(0, 0, 0, 1);

  return {
    canvas,
    mode: 'gpu',
    render(video) {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
      resize(canvas, video, WIDE_WARP.maxLongSide);
      const p = warpParams(video.videoWidth / video.videoHeight, canvas.width / canvas.height, settings());
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.uniform1f(uniforms.sourceAspect, p.As);
      gl.uniform1f(uniforms.outputAspect, p.Ao);
      gl.uniform1f(uniforms.strength, p.k);
      gl.uniform1f(uniforms.zoom, p.z);
      gl.uniform1f(uniforms.periphery, p.periphery);
      // GL의 y는 위가 +라 세로 이동만 부호를 바꾼다(pov-warp-lab.html 210행).
      gl.uniform2f(uniforms.offset, p.ox, -p.oy);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return true;
    },
  };
}

function createCpu(canvas: HTMLCanvasElement): WarpRenderer | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const sample = document.createElement('canvas');
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
  if (!sampleCtx) return null;
  let map: { key: string; map: CpuMap; image: ImageData } | null = null;
  return {
    canvas,
    mode: 'cpu',
    render(video) {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
      resize(canvas, video, WIDE_WARP.cpuMaxLongSide);
      const As = video.videoWidth / video.videoHeight;
      const { width: sw, height: sh } = cpuSampleSize(As);
      if (sample.width !== sw || sample.height !== sh) {
        sample.width = sw;
        sample.height = sh;
      }
      sampleCtx.drawImage(video, 0, 0, sw, sh);
      const src = sampleCtx.getImageData(0, 0, sw, sh).data;
      const p = warpParams(As, canvas.width / canvas.height, settings());
      const key = [canvas.width, canvas.height, sw, sh, p.As, p.Ao, p.k, p.z, p.ox, p.oy, p.periphery].join('|');
      if (!map || map.key !== key) map = { key, map: buildCpuMap(canvas.width, canvas.height, sw, sh, p), image: ctx.createImageData(canvas.width, canvas.height) };
      applyCpuMap(map.map, src, map.image.data);
      ctx.putImageData(map.image, 0, 0);
      return true;
    },
  };
}

/** WebGL2 → CPU 순서로 만든다. 둘 다 안 되면 null(휘지 않고 <video>를 그대로 쓴다). forceCpu는 /dev 비교용. */
export function createWarpRenderer(forceCpu = false): WarpRenderer | null {
  try {
    const gpu = forceCpu ? null : createGpu(document.createElement('canvas'));
    if (gpu) return gpu;
  } catch (e) {
    console.warn('[input] WebGL2 광각 실패, CPU로 전환', e);
  }
  try {
    return createCpu(document.createElement('canvas'));
  } catch (e) {
    console.warn('[input] CPU 광각도 실패, 휘지 않고 원본을 쓴다', e);
    return null;
  }
}
