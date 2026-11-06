// Files bundled as text (Vite `?raw`), e.g. Tomo's general Hatch.
declare module '*.yaml?raw' {
  const text: string
  export default text
}
