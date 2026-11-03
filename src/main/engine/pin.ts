// The Hermes release Tomo installs (mirrors scripts/hermes-pin.env; a test keeps them in step).
export interface HermesPin {
  tag: string
  commit: string
  python: string
  archiveUrl: string
  archiveSha256: string
}

export const HERMES_PIN: HermesPin = {
  tag: 'v0.21.7',
  commit: '71d34bad1045610252eda02ee79549436896e784',
  python: '3.14',
  archiveUrl: 'https://codeload.github.com/NousResearch/hermes-agent/tar.gz/71d34bad1045610252eda02ee79549436896e784',
  archiveSha256: 'a88ae3f634a3fd45050d3418d80b30ee5af51c89b9de40ec1ea3039d3024d77a',
}
