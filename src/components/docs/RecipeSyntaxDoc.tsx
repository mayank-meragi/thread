function Code({ children }: { children: string }) {
  return <pre className="docs-code">{children}</pre>
}

export function RecipeSyntaxDoc() {
  return (
    <div className="docs-body">
      <div className="eyebrow">Reference</div>
      <h1>Recipe syntax</h1>
      <p className="docs-lead">
        Recipe steps are written as plain text with a small set of inline tokens borrowed from{' '}
        <a href="https://cooklang.org" target="_blank" rel="noreferrer">Cooklang</a>. Type a token
        inside a step and it becomes a highlighted chip — the ingredient list, and the cook-mode
        checklist and timer, are all generated from these tokens automatically. Nothing needs to be
        entered twice.
      </p>

      <h2>Ingredients — <code>@</code></h2>
      <p>Write <code>@name{'{'}quantity%unit{'}'}</code> for a measured ingredient, or just <code>@name</code> if it has no amount worth tracking (a pinch of salt, an egg wash).</p>
      <Code>{`Whisk @eggs{2} and @milk{300%ml} together.\nSeason with @salt and @pepper.`}</Code>
      <ul>
        <li>Multi-word names need the braces even without a quantity: <code>@mustard seeds{'{'}{'}'}</code> — not <code>@{'{'}mustard seeds{'}'}</code>, the braces go after the name.</li>
        <li>Fractions work: <code>@flour{'{'}1/2%cup{'}'}</code>.</li>
        <li>The same ingredient written in two steps (e.g. <code>@cumin</code> used twice) is combined into one row in the ingredients panel.</li>
      </ul>

      <h2>Cookware — <code>#</code></h2>
      <p>Write <code>#name{'{'}{'}'}</code> for equipment or a cooking vessel: <code>#pressure cooker{'{'}{'}'}</code>, or a single word bare like <code>#pan</code>. Cookware is rendered as a chip for readability but, unlike ingredients, it does not build a separate list — v1 has no equipment tracking beyond the inline highlight.</p>
      <Code>{`In a #pressure cooker{}, dry roast @cumin and @mustard seeds{} until fragrant.\nHeat the #pan over medium heat.`}</Code>
      <p>A word starting with <code>#</code> that is not followed by a brace is only treated as cookware inside a recipe thread — everywhere else in Thread, <code>#word</code> is still an ordinary hashtag.</p>

      <h2>Timers — <code>~</code></h2>
      <p>Write <code>~{'{'}duration%unit{'}'}</code> for a bare timer, or <code>~label{'{'}duration%unit{'}'}</code> to name it. Recognised units: seconds/sec/s, minutes/min/m, hours/hr/h.</p>
      <Code>{`Simmer for ~{10%minutes}, stirring occasionally.\nRest ~resting{5%minutes} before slicing.`}</Code>
      <p>A step's <em>first</em> timer becomes that step's countdown in cook mode — the <strong>⏱</strong> button appears automatically while that step is active.</p>

      <h2>Putting it together</h2>
      <Code>{`Whisk @eggs{2} and @milk{300%ml} in a bowl.\nHeat a #pan{} over medium and melt @butter{1%tbsp}.\nPour in the mixture and cook for ~{3%minutes} until set.`}</Code>
      <p>This produces a two-ingredient shopping list (eggs, milk, butter), one cookware chip, and a step with a 3-minute timer — all read straight from the text above, with nothing else to fill in.</p>

      <h2>Editing</h2>
      <p>Editing is always plain text — click a step to edit its raw Markdown, tokens and all. Chips are just how the token renders when you are not editing that step.</p>
    </div>
  )
}
