# Who Pays the Tax? Build and deployment notes

A pilot learning object for the Evans strategy doc (Section 6, "Interactive visual or model": *a tax-incidence slider*).

## What it is

One self-contained file, `index.html`. It has no build step, no libraries, no server code and no database. Any web host that serves static files over HTTPS can serve it, and Canvas can embed it with an iframe.

**Audience:** MPA/MPP students in a microeconomics or public finance course.
**Learning outcome:** Explain why the economic incidence of a tax depends on relative elasticities rather than on who the law bills, and why deadweight loss grows with the square of the tax rate.
**Students do:** Predict, then test the prediction on the graph (four questions, with feedback and a "show me" button for each).

## Checked against the Section 9.4 guardrails

| Guardrail | Status |
|---|---|
| Accessibility (WCAG 2.2 AA), text alternative | Keyboard-operable controls, labeled sliders with spoken values, a results table and a plain-language summary that updates as the graph changes, and color never used alone (legend and labels). **Still needed:** a screen-reader pass (NVDA/VoiceOver) by the accessibility lead. |
| Student data (FERPA) | Collects nothing. No cookies, storage, analytics or network calls. |
| Content review by a subject expert | **Needed.** An econ faculty member should check the framing, the four questions and the feedback. Fill in the reviewer line in "About this model." |
| Named owner and school-controlled hosting | Owner listed as Evans Digital. Hosting: see below. |

## Deploying it: three steps

### 1. Put the file on a web host (HTTPS)

Pick one:

- **GitHub Pages (fastest for a pilot, free).** Create a repository (ideally under an Evans or UW GitHub organization, not a personal account), upload `index.html`, then go to Settings → Pages → Deploy from branch `main`. The URL looks like `https://<org>.github.io/<repo>/`.
- **A UW-controlled web host (better long-term).** Ask UW-IT or Evans web staff where static pages for teaching can live. This fits the strategy doc's "school-controlled hosting location" guardrail.
- **Canvas Files (quick test only).** Uploading the HTML file to Canvas Files usually works for a preview, but Canvas treats it as a file download, so it's unreliable inside an iframe. Don't use it for production.

### 2. Embed it in a Canvas page

In a Canvas Page, open the Rich Content Editor, switch to the **HTML editor** (the `</>` icon), and paste:

```html
<iframe
  src="https://YOUR-HOST/tax-incidence/"
  title="Interactive model: who pays a tax on soda"
  width="100%"
  height="1500"
  style="border:0; max-width:1040px;"
  loading="lazy"></iframe>
```

- The `title` is required for screen readers.
- Canvas doesn't resize iframes to fit their content, so the height is fixed. 1500px fits the graph and controls at typical widths, and students scroll inside the frame to reach the questions. If you'd rather avoid an inner scroll, use about 2600px.

### 3. Test as a student

- Use **Student View** in Canvas to confirm the iframe loads.
- Check it in the Canvas mobile app.
- If it shows a blank box: confirm the URL is HTTPS, and ask your Canvas admin whether the account's Content Security Policy allows the host's domain.

## Changing it

Everything you'd usually edit is in `index.html`:

- **Scenario text:** the `<h1>` and `.lede` paragraph near the top.
- **Starting values:** `DEFAULTS` and `P0`/`Q0` in the script.
- **Questions:** the `QUESTIONS` list. Each question has a prompt, options, the correct answer's index (counting from 0), feedback for right and wrong answers, and the graph settings its buttons apply.

## What this pilot shows about the workflow

Build time with AI help was under an hour, including a visual check at desktop, Canvas and phone widths. The steps that still need people are the ones Section 9.4 names: subject-expert review, accessibility testing and a hosting decision. That supports the doc's view that review capacity, not build time, is the scarce resource.
