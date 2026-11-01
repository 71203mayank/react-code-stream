import { StreamCode } from 'react-code-stream'
import { PrismLight } from 'react-syntax-highlighter'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import 'react-code-stream/styles.css'
import type { Renderer } from './labels'

for (const [name, grammar] of Object.entries({ typescript, javascript, go, cpp, python, markup, css })) {
  PrismLight.registerLanguage(name, grammar)
}

export function CodeView({ renderer, code, language, onError }: {
  renderer: Renderer; code: string; language: string; onError: (error: Error) => void
}) {
  return renderer === 'streamcode'
    ? <StreamCode language={language} theme="github-dark" linesPerBlock={10} autoScroll={false}
        className="benchmark-code" style={{ height: 430 }} onError={onError}>{code}</StreamCode>
    : <PrismLight language={language === 'html' ? 'markup' : language} style={vscDarkPlus}
        className="benchmark-code" showLineNumbers={false} wrapLongLines={false}
        customStyle={{ height: 430, margin: 0, padding: 16, boxSizing: 'border-box', fontSize: 13, lineHeight: 1.6 }}
        codeTagProps={{ style: { font: 'inherit' } }}>{code}</PrismLight>
}
