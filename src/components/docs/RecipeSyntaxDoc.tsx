function Code({ children }: { children: string }) {
  return <pre className="docs-code">{children}</pre>
}

export function RecipeSyntaxDoc() {
  return (
    <div className="docs-body">
      <div className="eyebrow">Reference</div>
      <h1>Recipe syntax</h1>
      <p className="docs-lead">
        Recipe threads are ordinary Markdown outlines. Structural tags describe the role of each
        bullet, indentation describes ownership, and a small set of inline tokens borrowed from{' '}
        <a href="https://cooklang.org" target="_blank" rel="noreferrer">Cooklang</a> describes
        ingredients, cookware and timers.
      </p>

      <h2>Recipe blocks</h2>
      <p>Use explicit tags in the thread Markdown. A section owns its nested steps, while notes provide context without becoming cooking steps.</p>
      <Code>{`- #[cook-section] Make the broth
  - #[cook-step] Add @water{2.5%cups} and @mushrooms{5}(sliced).
  - #[cook-step] Simmer in a ^pot for ~{20%minutes}.
  - #[cook-note] Keep the pot partially uncovered.

- #[cook-section] Cook the egg
  - #[cook-step] Crack the egg into the broth.
    - #[cook-note] Or boil it separately for 7–9 minutes.`}</Code>
      <ul>
        <li><code>#[cook-section]</code> is a heading/container and is not an executable step.</li>
        <li><code>#[cook-step]</code> appears in the Steps tab and Cook Mode.</li>
        <li><code>#[cook-note]</code> is displayed as supporting context and is excluded from shopping and completion counts.</li>
        <li>Indentation determines which section or step owns a nested block.</li>
      </ul>

      <h2>Ingredients — <code>@</code></h2>
      <p>Write <code>@name{'{'}quantity%unit{'}'}</code> for a measured ingredient, or just <code>@name</code> if it has no amount worth tracking (a pinch of salt, an egg wash).</p>
      <Code>{`Whisk @eggs{2} and @milk{300%ml} together.\nSeason with @salt and @pepper.`}</Code>
      <ul>
        <li>Multi-word names need the braces even without a quantity: <code>@mustard seeds{'{'}{'}'}</code> — not <code>@{'{'}mustard seeds{'}'}</code>, the braces go after the name.</li>
        <li>Fractions work: <code>@flour{'{'}1/2%cup{'}'}</code>.</li>
        <li>The same ingredient written in two steps (e.g. <code>@cumin</code> used twice) is combined into one row in the ingredients panel.</li>
      </ul>

      <h2>Cookware — <code>^</code></h2>
      <p>Write <code>^name{'{'}{'}'}</code> for equipment or a cooking vessel: <code>^pressure cooker{'{'}{'}'}</code>, or a single word bare like <code>^pan</code>. The caret keeps cookware separate from Thread tags such as <code>#[cook-step]</code>. Cookware is also collected in the Cookware tab.</p>
      <Code>{`In a ^pressure cooker{}, dry roast @cumin and @mustard seeds{} until fragrant.\nHeat the ^pan over medium heat.`}</Code>

      <h2>Timers — <code>~</code></h2>
      <p>Write <code>~{'{'}duration%unit{'}'}</code> for a bare timer, or <code>~label{'{'}duration%unit{'}'}</code> to name it. Recognised units: seconds/sec/s, minutes/min/m, hours/hr/h.</p>
      <Code>{`Simmer for ~{10%minutes}, stirring occasionally.\nRest ~resting{5%minutes} before slicing.`}</Code>
      <p>A step's <em>first</em> timer becomes that step's countdown in cook mode — the <strong>⏱</strong> button appears automatically while that step is active.</p>

      <h2>Putting it together</h2>
      <Code>{`- #[cook-section] Omelette\n  - #[cook-step] Whisk @eggs{2} and @milk{300%ml} in a ^bowl{}.\n  - #[cook-step] Heat the ^pan and melt @butter{1%tbsp}.\n  - #[cook-step] Pour in the mixture and cook for ~{3%minutes}.`}</Code>
      <p>This produces a three-ingredient shopping list, two cookware entries, a section, and a step with a 3-minute timer — all read straight from the thread Markdown.</p>

      <h2>Editing</h2>
      <p>Editing is always plain text — use the Thread editor to indent, outdent, add tags, and edit tokens. The recipe details view renders the same Markdown as structured sections, notes and chips.</p>
    </div>
  )
}
