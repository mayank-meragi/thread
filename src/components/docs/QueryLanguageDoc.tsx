function Q({ children }: { children: string }) {
  return (
    <pre className="docs-code">
      <span className="docs-code-fence">```tql</span>
      {'\n'}{children}{'\n'}
      <span className="docs-code-fence">```</span>
    </pre>
  )
}

export function QueryLanguageDoc() {
  return (
    <div className="docs-body">
      <div className="eyebrow">Reference</div>
      <h1>Query language</h1>
      <p className="docs-lead">
        A <strong>query block</strong> is a fenced code block whose language is <code>tql</code>.
        It runs a small SQL-flavoured query over your threads or tags and renders the result — a list or a
        table — right below the query. Results are live: they update as the underlying data changes.
      </p>

      <h2>Adding a query block</h2>
      <p>
        In any note (a day page or a thread page), start a fenced code block and set its language to
        <code>tql</code>, then type the query on the next line:
      </p>
      <Q>{`TABLE title, type FROM threads WHERE type = Trip`}</Q>
      <p>
        The code stays editable. Use the <strong>Hide query</strong> / <strong>Show query</strong> button in the
        result header to collapse the editor once you are happy with it — that choice is remembered per query on
        this device.
      </p>

      <h2>Query shape</h2>
      <pre className="docs-code">{`<SELECT>  FROM <source>  [WHERE <condition>]  [EDITABLE <fields>]  [SORT <field> ASC|DESC]  [LIMIT <n>]`}</pre>
      <ul>
        <li>Keywords (<code>FROM</code>, <code>WHERE</code>, <code>AND</code>, …) are case-insensitive.</li>
        <li>Everything after <code>FROM &lt;source&gt;</code> is optional.</li>
        <li>Clauses must appear in the order shown.</li>
      </ul>

      <h2>SELECT — what to show</h2>
      <table className="docs-table">
        <thead><tr><th>Form</th><th>Renders</th></tr></thead>
        <tbody>
          <tr>
            <td><code>LIST</code></td>
            <td>A bulleted list of links, labelled by the thread <code>title</code> (or tag <code>name</code>).</td>
          </tr>
          <tr>
            <td><code>LIST field, field, …</code></td>
            <td>The same list, with each named field shown as a small <code>label: value</code> chip beside the link.</td>
          </tr>
          <tr>
            <td><code>TABLE field, field, …</code></td>
            <td>A table with one column per field, in the order given. The first column links to the row.</td>
          </tr>
        </tbody>
      </table>
      <Q>{`LIST FROM threads WHERE type = Trip`}</Q>
      <Q>{`LIST rating, status FROM threads WHERE type = Trip`}</Q>
      <Q>{`TABLE title, rating, updated FROM threads WHERE type = Trip`}</Q>

      <h2>FROM — the source</h2>
      <p>Exactly one source per query.</p>

      <h3><code>FROM threads</code></h3>
      <p>One row per thread. Available fields:</p>
      <table className="docs-table">
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>title</code> / <code>name</code></td><td>The thread name.</td></tr>
          <tr><td><code>id</code></td><td>The thread’s slug (used in its URL).</td></tr>
          <tr><td><code>origin</code></td><td><code>manual</code> for threads you created directly, otherwise empty.</td></tr>
          <tr><td><code>created</code>, <code>updated</code></td><td>ISO timestamps.</td></tr>
          <tr><td><em>any property</em></td><td>Every property on the thread, referenced by its name — see <a href="#fields">Referring to fields</a>.</td></tr>
        </tbody>
      </table>

      <h3><code>FROM tags</code></h3>
      <p>One row per tag definition. Available fields:</p>
      <table className="docs-table">
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>name</code> / <code>title</code></td><td>The tag name.</td></tr>
          <tr><td><code>id</code></td><td>The tag slug.</td></tr>
          <tr><td><code>color</code></td><td>Hex colour, if set.</td></tr>
          <tr><td><code>property_count</code></td><td>How many properties the tag’s schema carries.</td></tr>
          <tr><td><code>usage</code></td><td>How many blocks currently carry the tag.</td></tr>
          <tr><td><code>created</code>, <code>updated</code></td><td>ISO timestamps.</td></tr>
        </tbody>
      </table>
      <Q>{`TABLE name, property_count, usage FROM tags WHERE usage > 0 SORT usage DESC`}</Q>

      <h2 id="fields">Referring to fields</h2>
      <p>
        A field name is matched loosely: <code>"Due date"</code>, <code>due-date</code> and <code>due_date</code>
        all resolve to the same property. Quote a name that contains spaces. An optional <code>prop.</code>
        prefix is ignored, so <code>prop.status</code> and <code>status</code> are equivalent.
      </p>

      <h2>WHERE — filtering</h2>

      <h3>Comparisons</h3>
      <table className="docs-table">
        <thead><tr><th>Operator</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><code>=</code>, <code>!=</code></td><td>Equality. Text compares case-insensitively. On a list-valued property, <code>=</code> tests membership.</td></tr>
          <tr><td><code>&gt;</code>, <code>&lt;</code>, <code>&gt;=</code>, <code>&lt;=</code></td><td>Ordered comparison — numeric for number fields, chronological for date fields, otherwise lexical.</td></tr>
          <tr><td><code>CONTAINS</code></td><td>Substring match on text; “has element” on a list-valued property.</td></tr>
        </tbody>
      </table>

      <h3>Values</h3>
      <ul>
        <li><strong>Bare word</strong> — treated as text: <code>status = active</code>.</li>
        <li><strong>Quoted string</strong> — text with spaces or punctuation: <code>title CONTAINS "road trip"</code>.</li>
        <li><strong>Number</strong> — <code>rating &gt;= 8</code>.</li>
        <li><strong>Boolean</strong> — <code>archived = true</code>.</li>
        <li><strong>Date</strong> — an ISO date <code>2026-09-01</code>, or a phrase like <code>today</code> / <code>next monday</code> on a date field.</li>
        <li><strong><code>null</code></strong> — <code>due-date = null</code> matches rows where the field is unset (<code>!= null</code> for the opposite).</li>
      </ul>
      <p>
        For a <code>select</code> or <code>status</code> property you can match either the option’s id or its
        visible label: <code>status = "In progress"</code> and <code>status = in_progress</code> both work.
      </p>

      <h3>Combining conditions</h3>
      <ul>
        <li><code>AND</code>, <code>OR</code>, <code>NOT</code>, and parentheses for grouping.</li>
        <li><code>AND</code> is implied between adjacent conditions, so <code>type = Trip rating &gt;= 8</code> means <code>type = Trip AND rating &gt;= 8</code>.</li>
        <li><code>AND</code> binds tighter than <code>OR</code>.</li>
        <li>A bare field name with no operator is a truthiness test: <code>archived</code> matches rows where <code>archived</code> is set and not false/empty.</li>
      </ul>
      <Q>{`LIST FROM threads WHERE type = Trip AND (rating >= 8 OR NOT visited)`}</Q>

      <h2>SORT and LIMIT</h2>
      <p>
        <code>SORT &lt;field&gt;</code> orders the result, ascending by default; add <code>DESC</code> to reverse.
        Numbers and dates sort naturally, text sorts alphabetically. <code>LIMIT &lt;n&gt;</code> keeps only the
        first <code>n</code> rows.
      </p>
      <Q>{`TABLE title, start FROM threads WHERE type = Trip SORT start ASC LIMIT 5`}</Q>

      <h2>EDITABLE — edit values in place</h2>
      <p>
        List the fields you want to change directly from the result. Each named field renders as an input
        (a text box, number box, date picker, or dropdown, matching the property type); editing it writes
        straight back to the thread, and every query block that shows that value refreshes.
      </p>
      <Q>{`TABLE title, rating, status FROM threads WHERE type = Trip EDITABLE rating, status`}</Q>
      <Q>{`LIST rating FROM threads WHERE type = Trip EDITABLE rating`}</Q>
      <ul>
        <li>Only <code>FROM threads</code> property fields become editable. Built-in fields (<code>title</code>, <code>id</code>, <code>created</code>, <code>updated</code>, …) and <code>FROM tags</code> results stay read-only — an <code>EDITABLE</code> field that isn’t a writable property is just shown as text.</li>
        <li>Clearing an input removes the property from the thread.</li>
        <li>An invalid value (e.g. letters in a number field) is rejected and reported in the result header; nothing is saved.</li>
      </ul>

      <h2>Examples</h2>

      <h3>Upcoming trips, soonest first</h3>
      <Q>{`TABLE title, start, destination FROM threads WHERE type = Trip AND start >= today SORT start ASC`}</Q>

      <h3>Active projects I haven’t touched in a while</h3>
      <Q>{`TABLE title, updated FROM threads WHERE status = active AND updated < 2026-08-01 SORT updated ASC`}</Q>

      <h3>Everything tagged, by how much you use it</h3>
      <Q>{`TABLE name, usage FROM tags SORT usage DESC LIMIT 10`}</Q>

      <h3>Threads whose notes mention a keyword in the title</h3>
      <Q>{`LIST FROM threads WHERE title CONTAINS onboarding`}</Q>

      <h2>Errors</h2>
      <p>
        If a query can’t be parsed, the block shows the message and the character position instead of a result.
        Fix the text and the result reappears — nothing is lost.
      </p>

      <h2>Not supported yet</h2>
      <p>
        <code>GROUP BY</code>, computed columns and functions, joining two sources, and output types beyond
        <code>LIST</code> / <code>TABLE</code>. The clause order above leaves room for these later.
      </p>
    </div>
  )
}
