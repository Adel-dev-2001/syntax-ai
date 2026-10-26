import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  Copy,
  Play,
  Code,
  Maximize2,
  Minimize2,
  Loader2,
  Download,
} from "lucide-react";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "motion/react";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

const StreamingContext = React.createContext<boolean>(false);

function AnimatedImage({ alt, src }: { alt?: string; src?: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [debouncedSrc, setDebouncedSrc] = useState(src);
  const isStreaming = React.useContext(StreamingContext);

  React.useEffect(() => {
    if (!isStreaming) {
      setDebouncedSrc(src);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSrc(src);
    }, 1500); // Wait for streaming to settle
    return () => clearTimeout(timer);
  }, [src, isStreaming]);

  const handleDownload = async () => {
    if (!src) return;
    try {
      const resp = await fetch(src);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `syntax-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download image", error);
      window.open(src, "_blank");
    }
  };

  return (
    <span className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-muted/50 to-muted border border-border/50 shadow-sm my-6 flex items-center justify-center min-h-[300px] md:min-h-[400px] max-w-3xl mx-auto group">
      <AnimatePresence>
        {isLoading && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-background/40 backdrop-blur-md z-10"
          >
            <span className="relative flex items-center justify-center">
              <motion.span
                animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="absolute w-16 h-16 bg-primary/20 blur-xl rounded-full"
              />
              <Loader2 className="w-8 h-8 text-primary animate-spin relative z-10" />
            </span>
            <motion.span
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="block text-sm font-semibold text-foreground tracking-widest uppercase bg-primary/10 px-4 py-1.5 rounded-full"
            >
              Generating image...
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
      {debouncedSrc && (
        <img
          src={debouncedSrc}
          alt={alt || "Generated Image"}
          onLoad={() => setIsLoading(false)}
          className={cn(
            "max-w-full max-h-[70vh] rounded-2xl object-contain shadow-2xl z-0 relative group-hover:scale-[1.02] transition-transform duration-500 ease-out",
            isLoading ? "opacity-0 blur-md" : "opacity-100 blur-0",
          )}
        />
      )}
      {!isLoading && debouncedSrc && (
        <button
          onClick={handleDownload}
          className="absolute top-4 right-4 bg-background/80 hover:bg-background text-foreground backdrop-blur-md p-2 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity border border-border/50 hover:border-primary/50 shadow-sm z-20 flex items-center justify-center"
          title="Download Image"
        >
          <Download size={18} />
        </button>
      )}
    </span>
  );
}

const markdownComponents = {
  img({ node, ...props }: any) {
    return <AnimatedImage src={props.src} alt={props.alt} />;
  },
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";
    const isInline = inline || !match;

    if (isInline) {
      return (
        <code
          className="bg-muted px-1.5 py-0.5 rounded-md font-mono text-sm"
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <CodeBlock
        language={language}
        value={String(children).replace(/\n$/, "")}
      />
    );
  },
  table({ children }: any) {
    return (
      <div className="overflow-x-auto my-4 w-full">
        <table className="w-full border-collapse border border-border">
          {children}
        </table>
      </div>
    );
  },
  th({ children }: any) {
    return (
      <th className="border border-border bg-muted px-4 py-2 font-semibold text-left">
        {children}
      </th>
    );
  },
  td({ children }: any) {
    return <td className="border border-border px-4 py-2">{children}</td>;
  },
};

export function MarkdownRenderer({
  content,
  isStreaming,
}: MarkdownRendererProps) {
  return (
    <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none break-words">
      <StreamingContext.Provider value={!!isStreaming}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </StreamingContext.Provider>
    </div>
  );
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getPreviewHtml = (lang: string, code: string) => {
    const lowerLang = lang.toLowerCase();
    if (lowerLang === "html" || lowerLang === "svg" || lowerLang === "xml") {
      return code;
    }
    if (lowerLang === "css") {
      return `<!DOCTYPE html><html><head><style>${code}</style></head><body><div style="padding: 20px; font-family: sans-serif;"><h1>CSS Preview</h1><p>This is a sample text to see CSS styles applied.</p><div class="container"><button class="btn">Sample Button</button></div></div></body></html>`;
    }
    if (lowerLang === "javascript" || lowerLang === "js") {
      return `<!DOCTYPE html><html><head><style>body { font-family: monospace; padding: 10px; background: #1e1e1e; color: #d4d4d4; margin: 0; }</style></head><body><h2>Console Output:</h2><div id="output"></div><script>
        const out = document.getElementById('output');
        const oldLog = console.log;
        console.log = function(...args) {
           oldLog(...args);
           args.forEach(a => { out.innerHTML += '<div>' + (typeof a === 'object' ? JSON.stringify(a) : a) + '</div>'; });
        };
        const oldErr = console.error;
        console.error = function(...args) {
           oldErr(...args);
           args.forEach(a => { out.innerHTML += '<div style="color:red">' + (typeof a === 'object' ? JSON.stringify(a) : a) + '</div>'; });
        };
        try {
           ${code}
        } catch (e) {
           console.error(e);
        }
      </script></body></html>`;
    }
    if (lowerLang === "jsx" || lowerLang === "tsx" || lowerLang === "react") {
      let escapedCode = code.replace(
        /import\s+.*?\s+from\s+['"].*?['"]\s*;/g,
        "",
      ); // strip imports with semicolon
      escapedCode = escapedCode.replace(
        /import\s+.*?\s+from\s+['"].*?['"]/g,
        "",
      ); // strip imports without semicolon
      escapedCode = escapedCode.replace(/export\s+default\s+/g, "");
      escapedCode = escapedCode.replace(/export\s+/g, "");

      return `<!DOCTYPE html><html><head>
          <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
          <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
          <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
          <script src="https://cdn.tailwindcss.com"></script>
        </head><body><div id="root"></div><script type="text/babel" data-type="module">
          window.process = { env: { NODE_ENV: 'development' } };
          const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext } = React;
          window.useState = useState; window.useEffect = useEffect; window.useRef = useRef; window.useMemo = useMemo; window.useCallback = useCallback;
          
          ${escapedCode}
          
          if (typeof App !== 'undefined') {
              const root = ReactDOM.createRoot(document.getElementById('root'));
              root.render(<App />);
          } else if (typeof Example !== 'undefined') {
              const root = ReactDOM.createRoot(document.getElementById('root'));
              root.render(<Example />);
          } else {
               document.getElementById('root').innerHTML = "<div style='padding:20px'>Rendered successfully but could not find an 'App' or 'Example' component to mount.</div>";
          }
        </script></body></html>`;
    }
    return code;
  };

  const isPreviewable = [
    "html",
    "svg",
    "xml",
    "css",
    "javascript",
    "js",
    "jsx",
    "tsx",
    "react",
  ].includes(language.toLowerCase());

  return (
    <div className="relative my-4 rounded-xl overflow-hidden bg-input border border-border font-mono text-xs shadow-sm">
      <div className="bg-muted/50 px-4 py-2 flex items-center justify-between border-b border-border">
        <span className="text-muted-foreground font-semibold lowercase tracking-wider">
          {language || "code"}
        </span>
        <div className="flex items-center gap-4">
          {isPreviewable && (
            <>
              {showPreview && (
                <button
                  onClick={() => setIsFullscreen(true)}
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
                  title="Full Screen Preview"
                >
                  <Maximize2 size={14} />
                  <span className="hidden sm:inline pt-0.5">Focus</span>
                </button>
              )}
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors"
                title={showPreview ? "View Code" : "Run Code"}
              >
                {showPreview ? <Code size={14} /> : <Play size={14} />}
                <span className="pt-0.5">{showPreview ? "Code" : "Run"}</span>
              </button>
            </>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            title="Copy code"
          >
            {copied ? (
              <Check size={14} className="text-emerald-500" />
            ) : (
              <Copy size={14} />
            )}
            <span className="pt-0.5">{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      {showPreview ? (
        <div
          className={cn(
            "bg-white overflow-hidden p-0 m-0 w-full transition-all duration-300",
            isFullscreen
              ? "fixed inset-0 z-[100] rounded-none h-screen w-screen"
              : "relative rounded-b-xl min-h-[400px]",
          )}
        >
          {isFullscreen && (
            <button
              onClick={() => setIsFullscreen(false)}
              className="absolute top-4 right-4 z-[110] bg-black/50 hover:bg-black/80 text-white p-2.5 rounded-full backdrop-blur-sm transition-all hover:scale-110 active:scale-95 shadow-lg flex items-center justify-center"
            >
              <Minimize2 size={24} />
            </button>
          )}
          <iframe
            srcDoc={getPreviewHtml(language, value)}
            title="Preview"
            className={cn(
              "w-full h-full border-none",
              isFullscreen ? "min-h-screen" : "min-h-[400px]",
            )}
            style={{ display: "block", backgroundColor: "#ffffff" }}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div
          className="p-4 overflow-x-auto text-sm leading-relaxed text-emerald-400/90"
          dir="ltr"
        >
          <pre>
            <code className="text-[13px]">{value}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
