// Screenshots and canvas exports arrive as data URLs; rebuilding them as
// Files lets the composer stage them through the exact same upload path as
// picked, pasted or dropped files (preview, size cap and all).
export const dataUrlToFile = (dataUrl: string, name: string): File => {
  const comma = dataUrl.indexOf(",")
  const meta = comma < 0 ? "" : dataUrl.slice(0, comma)
  const data = comma < 0 ? dataUrl : dataUrl.slice(comma + 1)
  if (!data) throw new Error("Screenshot data is empty")
  const type = /:(.*?);/.exec(meta)?.[1] ?? "image/png"
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], name, { type })
}
