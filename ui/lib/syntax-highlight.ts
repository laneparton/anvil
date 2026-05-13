export type HighlightToken = {
  content: string;
  color?: string;
  fontStyle?: number;
};

type Highlighter = {
  codeToTokens: (
    code: string,
    options: { lang: string; theme: string; tokenizeMaxLineLength?: number },
  ) => { tokens: HighlightToken[][] } | Promise<{ tokens: HighlightToken[][] }>;
};

let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter() {
  highlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("@shikijs/langs/tsx"),
    import("@shikijs/themes/github-light"),
  ]).then(([core, engine, lang, theme]) => {
    const highlighter = core.createHighlighterCore({
      themes: [theme.default],
      langs: [lang.default],
      engine: engine.createJavaScriptRegexEngine(),
    });

    return highlighter as Promise<Highlighter> | Highlighter;
  });

  return highlighterPromise;
}

export async function highlightTypeScriptLines(lines: string[]): Promise<HighlightToken[][]> {
  const highlighter = await getHighlighter();
  const result = await highlighter.codeToTokens(lines.join("\n"), {
    lang: "tsx",
    theme: "github-light",
    tokenizeMaxLineLength: 500,
  });

  return result.tokens.map((line: HighlightToken[]) =>
    line.map((token: HighlightToken) => ({
      content: token.content,
      color: token.color,
      fontStyle: token.fontStyle,
    })),
  );
}
