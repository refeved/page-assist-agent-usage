import "katex/dist/katex.min.css"

import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import ReactMarkdown from "react-markdown"
import rehypeKatex from "rehype-katex"

import "property-information"
import React, { createContext, useContext } from "react"
import { CodeBlock } from "./CodeBlock"
import { TableBlock } from "./TableBlock"
import { preprocessLaTeX } from "@/utils/latex"
import { useStorage } from "@plasmohq/storage/hook"

// These must be defined once at module scope. react-markdown uses each
// renderer as the React element *type*, so recreating them on every render
// (e.g. inline in JSX) makes React unmount/remount every <p>, <code>, <a>
// and <table> on each streamed chunk — which destroys text selection while
// a response is streaming and re-highlights every code block per token.
const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [rehypeKatex]
export const RemoteMarkdownContext = createContext(false)

const markdownComponents: React.ComponentProps<
  typeof ReactMarkdown
>["components"] = {
  pre({ children }) {
    return children
  },
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "")
    return !inline ? (
      <CodeBlock
        language={match ? match[1] : ""}
        value={String(children).replace(/\n$/, "")}
      />
    ) : (
      <code dir="ltr" className={`${className} font-semibold`} {...props}>
        {children}
      </code>
    )
  },
  a({ node, ...props }) {
    return (
      <a
        target="_blank"
        rel="noreferrer"
        className="text-blue-500 text-sm hover:underline"
        {...props}>
        {props.children}
      </a>
    )
  },
  table({ children }) {
    return <TableBlock>{children}</TableBlock>
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>
  }
}

const remoteMarkdownComponents: typeof markdownComponents = {
  ...markdownComponents,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ alt }) => <span>[{alt || "image"}]</span>,
  code({ inline, className, children }) {
    const language = /language-(\w+)/.exec(className || "")?.[1] || ""
    return inline ? (
      <code dir="ltr" className={`${className || ""} font-semibold`}>
        {children}
      </code>
    ) : (
      <CodeBlock
        language={language}
        value={String(children).replace(/\n$/, "")}
        allowPreview={false}
      />
    )
  }
}

function Markdown({
  message,
  className = "prose break-words dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 dark:prose-dark"
}: {
  message: string
  className?: string
}) {
  const [checkWideMode] = useStorage("checkWideMode", false)
  const remote = useContext(RemoteMarkdownContext)
  if (checkWideMode) {
    className += " max-w-none"
  }
  message = preprocessLaTeX(message)
  return (
    <React.Fragment>
      <ReactMarkdown
        skipHtml={remote}
        className={className}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={remote ? remoteMarkdownComponents : markdownComponents}>
        {message}
      </ReactMarkdown>
    </React.Fragment>
  )
}

export default Markdown
