/** Whether WebGL is running on the CPU (SwiftShader, llvmpipe, Microsoft Basic Render): no GPU, or a blocked one. */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): boolean {
  if (!gl) return false
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    return softwareRendererName(name)
  } catch {
    return false
  }
}

export function softwareRendererName(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen/i.test(name)
}
