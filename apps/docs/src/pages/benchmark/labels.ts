export type Renderer = 'streamcode' | 'syntax-highlighter'

export const rendererNames: Record<Renderer, string> = {
  streamcode: 'StreamCode', 'syntax-highlighter': 'react-syntax-highlighter (PrismLight)',
}
